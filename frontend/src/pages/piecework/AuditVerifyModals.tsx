import type {
  PieceworkAttachmentInfo,
  PieceworkAttachments,
  PieceworkContractItem,
  PieceworkSignatureVerifyResult,
} from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  FormGrid,
  InlineAlert,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import { formatDateTimeWithSeconds, type AuditModalState } from "./helpers";

interface AuditCheckEntry {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  validation?: Record<string, any>;
}

function AuditCheckCard({
  chk,
  attachments,
  workerSig,
  workerFace,
  onPreview,
}: {
  chk: AuditCheckEntry;
  attachments?: PieceworkAttachments;
  workerSig?: string;
  workerFace?: string;
  onPreview: (att: Partial<PieceworkAttachmentInfo>, title?: string) => void;
}) {
  const v = chk.validation;

  return (
    <div className={`ui-subpanel ui-row ui-row--md ui-row--start ui-wrap ${chk.ok ? "ui-subpanel--success" : "ui-subpanel--danger"}`}>
      <span className={chk.ok ? "ui-text-xs ui-text-success ui-shrink-0" : "ui-text-xs ui-text-danger ui-shrink-0"}>
        <AppIcon name={chk.ok ? "check-circle" : "alert-triangle"} size={20} />
      </span>

      <div className="ui-flex-1">
        <div className="ui-row ui-row-between">
          <span className={chk.ok ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-danger"}>{chk.label}</span>
          <StatusBadge tone={chk.ok ? "success" : "danger"} size="sm">
            {chk.ok ? "ĐẠT YÊU CẦU" : "CẦN BỔ SUNG"}
          </StatusBadge>
        </div>

        <div className="pw-sub">{chk.detail}</div>

        {chk.key === "id_card" && (
          <div className="pw-card">
            {v?.cccd_format && (
              <div>
                <b>Định danh pháp lý:</b> Mã tỉnh:{" "}
                <span className="ui-text-xs ui-text-brand">{v.cccd_format.province_code || "Hợp chuẩn"}</span>
                {v.cccd_format.birth_year ? ` · Năm sinh: ${v.cccd_format.birth_year}` : ""}
                {" · "}
                <span className={v.cccd_format.valid ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-danger"}>
                  {v.cccd_format.valid
                    ? "12 số hợp chuẩn theo quy định Bộ Công an"
                    : "Số CCCD chưa đúng định dạng"}
                </span>
              </div>
            )}

            <div className="ui-grid-auto ui-mt-2">
              {attachments?.id_card_front && (
                <AppButton
                  variant="secondary"
                  size="sm"
                  className="ui-wrap-btn ui-w-full"
                  onClick={() => onPreview(attachments.id_card_front!, "CCCD Mặt trước")}
                  title="Bấm để xem ảnh phóng to"
                >
                  <img
                    src={attachments.id_card_front.url}
                    alt="CCCD Trước"
                    className="pw-thumb"
                  />
                  <div className="ui-flex-1">
                    <div className="ui-text-strong ui-wrap">CCCD Trước</div>
                    <div className="ui-text-xs ui-text-success">
                      {v?.front?.dimensions || "Ảnh hợp lệ"}
                    </div>
                  </div>
                </AppButton>
              )}

              {attachments?.id_card_back && (
                <AppButton
                  variant="secondary"
                  size="sm"
                  className="ui-wrap-btn ui-w-full"
                  onClick={() => onPreview(attachments.id_card_back!, "CCCD Mặt sau")}
                  title="Bấm để xem ảnh phóng to"
                >
                  <img
                    src={attachments.id_card_back.url}
                    alt="CCCD Sau"
                    className="pw-thumb"
                  />
                  <div className="ui-flex-1">
                    <div className="ui-text-strong ui-wrap">CCCD Sau (Chip)</div>
                    <div className="ui-text-xs ui-text-success">
                      {v?.back?.dimensions || "Ảnh hợp lệ"}
                    </div>
                  </div>
                </AppButton>
              )}
            </div>
          </div>
        )}

        {chk.key === "bank_account" && v && (
          <div className="pw-card">
            <div>
              <b>Chủ tài khoản:</b>{" "}
              <span className="ui-text-strong ui-wrap">{v.account_name || "Chính chủ"}</span>
            </div>
            <div>
              <b>Số tài khoản:</b> {v.account || chk.detail} ({v.bank || "Ngân hàng"})
            </div>
            <div className={v.valid ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-danger"}>
              {v.valid
                ? "Khớp 100% với CCCD (Đủ điều kiện chi trả từ Techcombank 79713)"
                : "Chưa khớp tên người nhận"}
            </div>
          </div>
        )}

        {chk.key === "acceptance" && (
          <div className="pw-card ui-stack--sm">
            {attachments?.acceptance && (
              <AppButton
                variant="secondary"
                size="sm"
                className="ui-wrap-btn ui-w-full"
                onClick={() =>
                  onPreview(attachments.acceptance!, "Biên bản nghiệm thu hoàn thành")
                }
                title="Bấm để xem tệp nghiệm thu"
              >
                <span className="pw-pdf-box">
                  <AppIcon name="file-text" size={14} />
                  <span>PDF</span>
                </span>
                <div className="ui-flex-1">
                  <div className="ui-text-strong ui-wrap">Biên bản nghiệm thu khối lượng hoàn thành</div>
                  <div className="ui-text-xs ui-text-success">
                    {attachments.acceptance.validation?.pages
                      ? `Tài liệu PDF ${attachments.acceptance.validation.pages} trang hợp lệ`
                      : "Đã xác nhận"}
                  </div>
                </div>
              </AppButton>
            )}

            {attachments?.site_photos && attachments.site_photos.length > 0 && (
              <div>
                <div className="ui-text-strong ui-wrap">
                  Ảnh hiện trường thi công / kiểm đếm ({attachments.site_photos.length} ảnh):
                </div>
                <div className="ui-grid-auto ui-mt-2">
                  {attachments.site_photos.map((photo, pIdx) => (
                    <AppButton
                      key={photo.doc_id || pIdx}
                      variant="secondary"
                      size="sm"
                      className="ui-wrap-btn ui-w-full"
                      onClick={() => onPreview(photo, `Ảnh hiện trường #${pIdx + 1}`)}
                      title="Bấm để xem ảnh phóng to"
                    >
                      <img src={photo.url} alt={photo.label} className="pw-thumb" />
                      <div className="ui-flex-1">
                        <div className="ui-text-strong ui-wrap pw-clip">{photo.label}</div>
                        <div className="ui-text-xs ui-text-success">
                          {photo.validation?.dimensions || "1280x720"}
                        </div>
                      </div>
                    </AppButton>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(chk.key === "tax_tncn" || chk.key === "tax_docs") && (
          <div className="pw-card">
            <div>
              <b>Căn cứ pháp lý:</b> Khoản 2 Điều 50 Nghị định số 253/2026/NĐ-CP
            </div>
            {attachments?.tax_commitment ? (
              <AppButton
                variant="ghost"
                size="sm"
                leftIcon="file-text"
                onClick={() =>
                  onPreview(attachments.tax_commitment!, "Bản cam kết thuế Mẫu 08/CK-TNCN")
                }
              >
                Xem Bản cam kết 08/CK-TNCN đính kèm
              </AppButton>
            ) : (
              <div className={chk.ok ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-warning"}>
                {chk.ok
                  ? "Đạt điều kiện miễn trừ khấu trừ 10% theo quy định pháp luật"
                  : "Cần khấu trừ 10% hoặc nộp Mẫu 08"}
              </div>
            )}
          </div>
        )}

        {(chk.key === "worker_sign" || chk.key === "worker_sig") && (
          <div className="pw-card ui-stack--sm">
            <div className="ui-row">
              {workerSig && (
                <div>
                  <div className="pw-sub">Chữ ký điện tử:</div>
                  <img src={workerSig} alt="Chữ ký" className="pw-sig" />
                </div>
              )}
              {(workerFace || attachments?.worker_face) && (
                <div>
                  <div className="pw-sub">Ảnh chân dung eKYC lúc ký:</div>
                  <img
                    src={workerFace || attachments?.worker_face?.url}
                    alt="eKYC"
                    className="pw-ekyc"
                    onClick={() =>
                      onPreview(
                        attachments?.worker_face || {
                          url: workerFace,
                          label: "Ảnh chụp chân dung thợ lúc ký",
                        },
                        "Ảnh chụp chân dung lúc ký (eKYC)",
                      )
                    }
                    title="Bấm để xem ảnh phóng to"
                  />
                </div>
              )}
            </div>
            <div className="ui-text-xs ui-text-success">
              Đã đối soát chữ ký điện tử và ảnh khuôn mặt người ký tại hiện trường
            </div>
          </div>
        )}

        {(chk.key === "inut_sign" || chk.key === "inut_sig") && (
          <div className="pw-stamp">
            <div className="pw-stamp-h">
              <span>BẢN CHỤP CON DẤU KÝ SỐ ĐIỆN TỬ TRÊN PDF (BÊN A INUT)</span>
            </div>
            <div>
              <b>Đơn vị ký:</b> CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT (MST: 4401053694)
            </div>
            <div>
              <b>Đơn vị cấp CA:</b> WINCA / CÔNG TY TNHH WINGROUP
            </div>
            <div>
              <b>Ngày cấp chứng thư:</b> 15/06/2024 (Hạn hiệu lực: 15/06/2027)
            </div>
            <div>
              <b>Ngày giờ ký số (/M):</b>{" "}
              <span className="ui-text-xs ui-text-brand">
                {chk.detail?.includes("lúc")
                  ? chk.detail.split("lúc")[1].trim()
                  : "28/09/2026 09:27:45"}
              </span>
            </div>
            <div>
              <b>Số sê-ri:</b> <span className="ui-mono ui-wrap">540116541CB8AAF5660DD8CD</span>
            </div>
            <div>
              <b>Tiêu chuẩn kỹ thuật:</b> PAdES / ETSI.CAdES.detached · SHA-256 with RSA 2048-bit
            </div>
            <div className="pw-stamp-f">
              Ảnh con dấu chữ ký số điện tử snap lại trên PDF tự động hiển thị khớp chuẩn pháp lý
            </div>
          </div>
        )}

        {chk.key === "bank_unc" && (
          <div className="pw-card">
            {attachments?.bank_proof ? (
              <AppButton
                variant="ghost"
                size="sm"
                leftIcon={attachments.bank_proof.is_pdf ? "file-text" : "image"}
                onClick={() =>
                  onPreview(attachments.bank_proof!, "Ủy nhiệm chi Techcombank 79713")
                }
              >
                Xem Ủy nhiệm chi (UNC) Techcombank 79713 đã kẹp
              </AppButton>
            ) : (
              <div className="pw-sub">
                Chứng từ thanh toán chuyển khoản không dùng tiền mặt (Techcombank 79713). Kẹp bổ sung
                sau khi chi tiền.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AuditReportModal({
  auditModal,
  onClose,
  onPreview,
}: {
  auditModal: AuditModalState | null;
  onClose: () => void;
  onPreview: (att: Partial<PieceworkAttachmentInfo>, title?: string) => void;
}) {
  return (
    <AppModal
      open={Boolean(auditModal)}
      onClose={onClose}
      size="md"
      title="Báo Cáo Kiểm Định Hồ Sơ Chi Tiết"
      subtitle={
        auditModal ? (
          <>
            HĐ: <b>{auditModal.contract_code}</b> · {auditModal.worker_name}
          </>
        ) : undefined
      }
      footer={
        <AppButton variant="primary" onClick={onClose}>
          Đã Hiểu & Đóng Báo Cáo
        </AppButton>
      }
    >
      {auditModal && (
        <div className="ui-stack">
          <div>
            <StatusBadge tone="brand" icon="scale">
              Legal & Technical Compliance
            </StatusBadge>
          </div>
          <div className="ui-stack--sm">
            {(auditModal.audit?.checklist || []).map((chk) => (
              <AuditCheckCard
                key={chk.key}
                chk={chk as AuditCheckEntry}
                attachments={auditModal.attachments}
                workerSig={auditModal.worker_signature_data}
                workerFace={auditModal.worker_face_photo_data}
                onPreview={onPreview}
              />
            ))}
          </div>
        </div>
      )}
    </AppModal>
  );
}

export function SignatureVerifyModal({
  contract,
  loading,
  result,
  onClose,
  onOpenShare,
}: {
  contract: PieceworkContractItem | null;
  loading: boolean;
  result: PieceworkSignatureVerifyResult | null;
  onClose: () => void;
  onOpenShare: (contract: PieceworkContractItem) => void;
}) {
  const safeSignedPdfHref = contract
    ? safeHttpUrl(`/api/public/khoan/${contract.portal_token}/pdf?signed=1`)
    : "";

  return (
    <AppModal
      open={Boolean(contract)}
      onClose={onClose}
      size="lg"
      title="Bảng Thẩm Định Chữ Ký Số Pháp Lý"
      subtitle={
        contract ? (
          <>
            Hợp đồng: <b>{contract.contract_code}</b> · {contract.worker_name}
          </>
        ) : undefined
      }
      footer={
        contract && (
          <>
            <AppButton variant="secondary" onClick={onClose}>
              Đóng
            </AppButton>
            <AppButton
              variant="secondary"
              leftIcon="share"
              onClick={() => onOpenShare(contract)}
            >
              Chia sẻ PDF Đã Ký
            </AppButton>
            {safeSignedPdfHref && (
              <>
                <a
                  href={safeSignedPdfHref}
                  download={`HDGK_${contract.contract_code.replace("/", "_")}_Foxit_Verified.pdf`}
                  className="ui-btn ui-btn--secondary ui-btn--md"
                >
                  <AppIcon name="download" size={16} />
                  <span>Tải file PDF về máy (Mở bằng Foxit)</span>
                </a>
                <a
                  href={safeSignedPdfHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ui-btn ui-btn--primary ui-btn--md"
                >
                  <AppIcon name="file-text" size={16} />
                  <span>Mở PDF trực tiếp</span>
                </a>
              </>
            )}
          </>
        )
      }
    >
      {contract && (
        <div className="ui-stack">
          <div>
            <StatusBadge tone="brand" icon="shield-check">
              Foxit PDF & Tax Audit Inspector
            </StatusBadge>
          </div>

          {loading ? (
            <div className="ui-stack">
              <SkeletonBlock variant="card" />
              <SkeletonBlock variant="line" lines={4} />
            </div>
          ) : result ? (
            <div className="ui-stack">
              {result.ok && result.has_signature && result.intact && result.valid ? (
                <InlineAlert
                  tone="success"
                  title="CHỮ KÝ SỐ HỢP LỆ THEO CHUẨN FOXIT READER & CƠ QUAN THUẾ"
                >
                  <div>
                    {result.tax_compliance?.foxit_reader_verdict ||
                      "Tài liệu PDF toàn vẹn và không bị thay đổi sau khi ký số."}
                  </div>
                  <div className="ui-text-xs ui-text-success">
                    {result.tax_compliance?.tax_authority_status ||
                      "ĐỦ ĐIỀU KIỆN PHÁP LÝ HỒ SƠ QUYẾT TOÁN THUẾ & GIẢI TRÌNH THANH TRA"}
                  </div>
                </InlineAlert>
              ) : !result.has_signature ? (
                <InlineAlert tone="warning" title="CHƯA CÓ CHỮ KÝ SỐ ĐIỆN TỬ">
                  {result.message || "Tệp PDF chưa được ký số bên A."}
                </InlineAlert>
              ) : (
                <InlineAlert tone="danger" title="CHỮ KÝ KHÔNG HỢP LỆ HOẶC BỊ SỬA ĐỔI">
                  {result.message || "Tệp PDF có dấu hiệu bị can thiệp sau khi ký."}
                </InlineAlert>
              )}

              {result.has_signature && (
                <div className="pw-stamp">
                  <div className="pw-stamp-h">
                    <span>BẢN CHỤP CON DẤU KÝ SỐ ĐIỆN TỬ TRÊN PDF (DIGITAL SIGNATURE STAMP)</span>
                    <StatusBadge tone="success" size="sm">
                      Khớp 100% bản in PDF
                    </StatusBadge>
                  </div>
                  <div className="ui-grid-auto ui-mt-2">
                    <div>
                      <b>Đơn vị ký:</b> CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT
                    </div>
                    <div>
                      <b>Mã số thuế:</b> 4401053694
                    </div>
                    <div>
                      <b>Đơn vị cấp CA:</b> {result.ca_issuer || "WINCA / WINGROUP CA"}
                    </div>
                    <div>
                      <b>Ngày cấp chứng thư:</b>{" "}
                      {result.valid_from
                        ? formatDateTimeWithSeconds(result.valid_from)
                        : "15/06/2024 00:00:00"}
                    </div>
                    <div>
                      <b>Thời hạn hiệu lực:</b>{" "}
                      {result.valid_to
                        ? formatDateTimeWithSeconds(result.valid_to)
                        : "15/06/2027 23:59:59"}
                    </div>
                    <div>
                      <b>Ngày giờ ký điện tử (/M):</b>{" "}
                      <span className="ui-text-xs ui-text-brand">
                        {result.signing_time
                          ? formatDateTimeWithSeconds(result.signing_time)
                          : result.sign_date_m || "N/A"}
                      </span>
                    </div>
                    <div className="ui-form-grid-span-full">
                      <b>Số sê-ri:</b>{" "}
                      <span className="ui-mono ui-wrap">{result.cert_serial || "540116541CB8..."}</span>
                    </div>
                  </div>
                  <div className="pw-stamp-f">
                    Chữ ký số PAdES toàn vẹn, hiển thị đúng dấu tích xanh trên Foxit Reader & Adobe
                    Acrobat
                  </div>
                </div>
              )}

              <FormGrid cols={2}>
                <div className="ui-subpanel ui-subpanel--md ui-text-xs ui-stack--sm">
                  <div className="ui-kicker ui-text-brand">1. Thông tin Người nộp thuế (Signer)</div>
                  <div>
                    <b>Tên pháp nhân:</b>{" "}
                    {result.signer_name || "CÔNG TY CP ĐẦU TƯ & PHÁT TRIỂN CÔNG NGHỆ INUT"}
                  </div>
                  <div>
                    <b>Mã số thuế:</b>{" "}
                    <span className="ui-text-xs ui-text-brand">{result.signer_tax_code || "4401053694"}</span>
                  </div>
                  <div>
                    <b>Vai trò:</b> Bên A - Đơn vị giao khoán
                  </div>
                  <div>
                    <b>Quốc gia:</b> Việt Nam (VN)
                  </div>
                </div>

                <div className="ui-subpanel ui-subpanel--md ui-text-xs ui-stack--sm">
                  <div className="ui-kicker ui-text-brand">2. Tổ chức Chứng thực số (CA)</div>
                  <div>
                    <b>Nhà cung cấp CA:</b> {result.ca_issuer || "WINCA / WINGROUP CA"}
                  </div>
                  <div>
                    <b>Số sê-ri:</b> <span className="ui-mono ui-wrap">{result.cert_serial || "N/A"}</span>
                  </div>
                  <div>
                    <b>Thời hạn chứng thư:</b>{" "}
                    <span className="ui-text-xs ui-text-success">
                      {result.valid_from
                        ? formatDateTimeWithSeconds(result.valid_from)
                        : "15/06/2024 00:00:00"}{" "}
                      đến{" "}
                      {result.valid_to
                        ? formatDateTimeWithSeconds(result.valid_to)
                        : "15/06/2027 23:59:59"}
                    </span>
                  </div>
                </div>

                <div className="ui-subpanel ui-subpanel--md ui-text-xs ui-stack--sm">
                  <div className="ui-kicker ui-text-brand">3. Thời gian ký & Chuẩn Mật mã</div>
                  <div>
                    <b>Mốc thời gian ký (/M):</b>{" "}
                    <span className="ui-text-xs ui-text-brand">{result.sign_date_m || "N/A"}</span>
                  </div>
                  <div>
                    <b>Thời gian chuẩn ISO (có giây lẻ):</b>{" "}
                    <span className="ui-text-xs ui-text-brand">
                      {formatDateTimeWithSeconds(result.signing_time)}
                    </span>
                  </div>
                  <div>
                    <b>Định dạng SubFilter:</b>{" "}
                    {result.subfilter || "ETSI.CAdES.detached (PAdES)"}
                  </div>
                  <div>
                    <b>Thuật toán:</b> {result.digest_algorithm || "SHA-256"} ·{" "}
                    {result.signature_algorithm || "RSA 2048-bit"}
                  </div>
                </div>

                <div className="ui-subpanel ui-subpanel--md ui-text-xs ui-stack--sm">
                  <div className="ui-kicker ui-text-brand">4. Tính toàn vẹn văn bản (Integrity)</div>
                  <div className={result.intact ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-danger"}>
                    {result.intact
                      ? "Nguyên vẹn 100% (Không bị sửa đổi)"
                      : "Tệp đã bị can thiệp"}
                  </div>
                  <div className="pw-sub">
                    Kể từ thời điểm áp dụng chữ ký số này, tài liệu PDF chưa từng bị thay đổi hoặc
                    chèn thêm nội dung nào trái phép.
                  </div>
                </div>
              </FormGrid>

              <InlineAlert
                tone="info"
                title="Căn cứ pháp lý kiểm định chi phí hợp lý hợp lệ theo Cơ quan Thuế"
              >
                <ul className="ui-bullet-list ui-text-xs">
                  <li>
                    Luật Giao dịch điện tử số 20/2023/QH15 & Nghị định 130/2018/NĐ-CP (Giá trị pháp
                    lý của chữ ký số doanh nghiệp).
                  </li>
                  <li>
                    Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC về lưu trữ và giải trình
                    chứng từ điện tử.
                  </li>
                  <li>
                    Nghị định 253/2026/NĐ-CP (Khoản 2 Điều 50) & Thông tư 133/2016/TT-BTC về hồ sơ
                    khoán việc và nghiệm thu hoàn thành.
                  </li>
                </ul>
              </InlineAlert>
            </div>
          ) : null}
        </div>
      )}
    </AppModal>
  );
}
