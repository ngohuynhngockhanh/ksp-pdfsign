import type {
  PieceworkAttachmentInfo,
  PieceworkContractDetail,
  PieceworkContractItem,
} from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  FormGrid,
  SectionCard,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import { formatDateTimeWithSeconds, isAttachmentPdf } from "./helpers";

interface DocumentCardProps {
  title: string;
  hasDoc: boolean;
  attachment?: PieceworkAttachmentInfo | null;
  uploading: boolean;
  onUpload: (file: File | undefined) => void;
  onDelete: () => void;
  onPreview: (att: PieceworkAttachmentInfo) => void;
  allowPdf?: boolean;
}

function DocumentCard({
  title,
  hasDoc,
  attachment,
  uploading,
  onUpload,
  onDelete,
  onPreview,
  allowPdf = true,
}: DocumentCardProps) {
  const isOk = hasDoc && attachment?.validation?.valid !== false;
  const isPdf = isAttachmentPdf(attachment);

  return (
    <div className="ui-subpanel ui-subpanel--md ui-text-xs ui-stack--sm ui-row-between">
      <div className="ui-stack--sm">
        <div className="ui-row ui-row-between">
          <span className="ui-text-strong ui-wrap">{title}</span>
          <StatusBadge
            size="sm"
            tone={isOk ? "success" : hasDoc ? "warning" : "danger"}
            icon={hasDoc ? "check" : "x"}
          >
            {hasDoc ? "Đã có tệp" : "Chưa có"}
          </StatusBadge>
        </div>

        {hasDoc && attachment && (
          <div className="pw-card ui-row">
            {isPdf ? (
              <AppButton
                variant="secondary"
                size="sm"
                className="pw-pdf-box"
                onClick={() => onPreview(attachment)}
                title="Bấm để xem trước tệp PDF"
                aria-label={`Xem trước PDF ${title}`}
              >
                <AppIcon name="file-text" size={14} />
                <span>PDF</span>
              </AppButton>
            ) : (
              <img
                src={attachment.url}
                alt={title}
                className="pw-thumb"
                onClick={() => onPreview(attachment)}
                title="Bấm để xem ảnh phóng to"
              />
            )}
            <div className="ui-flex-1">
              <div
                className={
                  attachment.validation?.valid
                    ? "ui-text-xs ui-text-success pw-clip"
                    : "ui-text-xs ui-text-danger pw-clip"
                }
              >
                {attachment.validation?.valid
                  ? attachment.validation.note || (isPdf ? "Tài liệu PDF" : "Ảnh hợp lệ")
                  : attachment.validation?.error || "Lỗi tệp"}
              </div>
              <div className="pw-sub">
                {attachment.validation?.dimensions
                  ? `Kích thước: ${attachment.validation.dimensions}`
                  : attachment.validation?.pages
                    ? `Số trang: ${attachment.validation.pages}`
                    : ""}
                {attachment.validation?.size_kb ? ` (${attachment.validation.size_kb} KB)` : ""}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="ui-row">
        <label className="ui-btn ui-btn--primary ui-btn--sm pw-file">
          <AppIcon name={uploading ? "loader" : hasDoc ? "refresh" : "upload"} size={14} />
          <span>{uploading ? "Đang tải…" : hasDoc ? "Thay tệp" : "Tải tệp lên"}</span>
          <input
            type="file"
            accept={allowPdf ? "image/*,.pdf" : "image/*"}
            className="ui-hidden"
            disabled={uploading}
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </label>

        {hasDoc && attachment && (
          <>
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="eye"
              onClick={() => onPreview(attachment)}
              title="Xem trước tài liệu"
            >
              Xem
            </AppButton>
            <AppButton
              variant="danger"
              size="sm"
              iconOnly
              leftIcon="trash"
              aria-label="Xóa tệp chứng từ này"
              title="Xóa tệp chứng từ này"
              onClick={onDelete}
            />
          </>
        )}
      </div>
    </div>
  );
}

export interface ContractDetailModalProps {
  detail: PieceworkContractDetail | null;
  uploadingKind: string | null;
  syncingDriveId: number | null;
  onClose: () => void;
  onOpenEdit: (contractId: number) => void;
  onAudit: (contract: PieceworkContractItem) => void;
  onOpenShare: (contract: PieceworkContractDetail, tab: "signed" | "unsigned") => void;
  onVerifySignature: (contract: PieceworkContractDetail) => void;
  onOpenSigning: (contract: PieceworkContractDetail) => void;
  onToggleChecklist: (contractId: number, field: string, currentValue: boolean) => void;
  onUploadDoc: (contractId: number, docKind: string, file: File | undefined) => Promise<void> | void;
  onDeleteDoc: (contractId: number, docKind: string, docId?: string) => void;
  onSyncDrive: (contract: PieceworkContractDetail) => void;
  onPreview: (att: Partial<PieceworkAttachmentInfo>, title?: string) => void;
}

export function ContractDetailModal({
  detail,
  uploadingKind,
  syncingDriveId,
  onClose,
  onOpenEdit,
  onAudit,
  onOpenShare,
  onVerifySignature,
  onOpenSigning,
  onToggleChecklist,
  onUploadDoc,
  onDeleteDoc,
  onSyncDrive,
  onPreview,
}: ContractDetailModalProps) {
  const safeDriveHref = detail ? safeHttpUrl(detail.drive_link) : "";
  const safePdfHref = detail ? safeHttpUrl(`/api/public/khoan/${detail.portal_token}/pdf`) : "";

  return (
    <AppModal
      open={Boolean(detail)}
      onClose={onClose}
      size="lg"
      title="Chi tiết Hồ sơ & Deficiency Checklist"
      subtitle={
        detail ? (
          <>
            Hợp đồng số: <b>{detail.contract_code}</b> · {detail.project_name}
          </>
        ) : undefined
      }
      footer={
        detail && (
          <>
            <AppButton variant="secondary" onClick={onClose}>
              Đóng
            </AppButton>
            <AppButton
              variant="secondary"
              leftIcon="share"
              onClick={() => onOpenShare(detail, detail.is_signed_by_inut ? "signed" : "unsigned")}
            >
              Chia sẻ PDF (Đã ký / Chưa ký)
            </AppButton>
            <AppButton
              variant="secondary"
              leftIcon="shield-check"
              onClick={() => onVerifySignature(detail)}
            >
              Thẩm định Chữ ký số
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon={detail.is_signed_by_worker ? "file-signature" : "clock"}
              disabled={!detail.is_signed_by_worker}
              onClick={() => onOpenSigning(detail)}
              title={
                !detail.is_signed_by_worker
                  ? "Chờ người nhận khoán (Bên B) ký online trước khi Bên A ký số"
                  : undefined
              }
            >
              {!detail.is_signed_by_worker
                ? "Chờ Bên B ký trước"
                : detail.is_signed_by_inut
                  ? "Ký lại số INUT"
                  : "Ký số Bên A (INUT)"}
            </AppButton>
            {safePdfHref && (
              <a
                href={safePdfHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-btn ui-btn--secondary ui-btn--md"
              >
                <AppIcon name="file-text" size={16} />
                <span>Mở PDF</span>
              </a>
            )}
          </>
        )
      }
    >
      {detail && (
        <div className="ui-stack">
          <div className="ui-row ui-row-end">
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="edit"
              onClick={() => onOpenEdit(detail.id)}
            >
              Sửa HĐ
            </AppButton>
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="file-search"
              onClick={() => onAudit(detail)}
            >
              Kiểm định
            </AppButton>
          </div>

          <SectionCard title="Trạng thái Checklist hồ sơ thiếu" icon="clipboard-check" padding="compact">
            <div className="ui-stack--sm">
              {detail.deficiency.checklist.map((chk) => (
                <div
                  key={chk.key}
                  className={`ui-subpanel ui-row ui-row--md ui-row--start ui-wrap ${chk.ok ? "ui-subpanel--success" : "ui-subpanel--danger"}`}
                >
                  <div className="ui-flex-1">
                    <div className={chk.ok ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-danger"}>{chk.label}</div>
                    <div className="pw-sub">{chk.detail}</div>
                  </div>
                  {chk.key === "acceptance" && (
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon={detail.has_acceptance ? "x" : "check"}
                      onClick={() => onToggleChecklist(detail.id, "has_acceptance", detail.has_acceptance)}
                    >
                      {detail.has_acceptance ? "Bỏ nghiệm thu" : "Duyệt nghiệm thu"}
                    </AppButton>
                  )}
                  {chk.key === "bank_unc" && (
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon={detail.has_bank_proof ? "x" : "check"}
                      onClick={() => onToggleChecklist(detail.id, "has_bank_proof", detail.has_bank_proof)}
                    >
                      {detail.has_bank_proof ? "Bỏ kẹp UNC" : "Kẹp UNC Techcombank"}
                    </AppButton>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {detail.worker_signature_data && (
            <SectionCard
              title="Bằng Chứng Xác Thực Ký Điện Tử & Chân Dung eKYC của Thợ"
              icon="user-check"
              padding="compact"
              tone="subtle"
              actions={
                <StatusBadge tone="success" size="sm" icon="check">
                  Đã xác thực
                </StatusBadge>
              }
            >
              <div className="ui-row">
                <div>
                  <div className="pw-sub">Chữ ký tay cảm ứng:</div>
                  <img
                    src={detail.worker_signature_data}
                    className="pw-sig"
                    alt="Chữ ký thợ"
                  />
                  <div className="pw-sub">Ký lúc: {detail.worker_signed_at || "N/A"}</div>
                </div>

                {(detail.worker_face_photo_data || detail.attachments?.worker_face) && (
                  <div>
                    <div className="pw-sub">Ảnh chân dung eKYC chụp lúc ký:</div>
                    <img
                      src={detail.worker_face_photo_data || detail.attachments?.worker_face?.url}
                      alt="Ảnh chân dung eKYC"
                      className="pw-ekyc"
                      onClick={() =>
                        onPreview(
                          detail.attachments?.worker_face || {
                            url: detail.worker_face_photo_data,
                            label: "Ảnh chụp chân dung thợ lúc ký",
                          },
                          `Chân dung eKYC - ${detail.worker_name}`,
                        )
                      }
                      title="Bấm để xem ảnh phóng to"
                    />
                    <div className="ui-text-xs ui-text-success">Camera định danh</div>
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {detail.is_signed_by_inut && (
            <SectionCard
              title="Chữ Ký Số Doanh Nghiệp Bên A (INUT Technology) — Bản Snap Trên PDF"
              icon="shield-check"
              padding="compact"
              actions={
                <StatusBadge tone="success" size="sm" icon="badge-check">
                  Đã đóng dấu số điện tử
                </StatusBadge>
              }
            >
              <div className="pw-stamp">
                <div className="pw-stamp-h">
                  <span>KÝ SỐ ĐIỆN TỬ BỞI: CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</span>
                </div>
                <div className="ui-grid-auto ui-mt-2">
                  <div>
                    <b>Mã số thuế:</b> 4401053694
                  </div>
                  <div>
                    <b>Đơn vị cấp CA:</b> WINCA / CÔNG TY TNHH WINGROUP
                  </div>
                  <div>
                    <b>Ngày cấp chứng thư:</b> 15/06/2024 (Hạn dùng: 15/06/2027)
                  </div>
                  <div>
                    <b>Ngày giờ ký điện tử (/M):</b>{" "}
                    <span className="ui-text-xs ui-text-brand">
                      {formatDateTimeWithSeconds(detail.inut_signed_at)}
                    </span>
                  </div>
                  <div className="ui-form-grid-span-full">
                    <b>Số sê-ri:</b> <span className="ui-mono ui-wrap">540116541CB8AAF5...</span>
                  </div>
                </div>
                <div className="pw-stamp-f">
                  Chữ ký số PAdES toàn vẹn, hiển thị đúng dấu tích xanh trên Foxit Reader & Adobe Acrobat
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard
            title="Chứng từ Đính kèm & Tự động Kiểm định Tính Hợp lệ"
            subtitle="Hỗ trợ JPG, PNG, PDF"
            icon="paperclip"
            padding="compact"
          >
            <FormGrid cols={2}>
              <DocumentCard
                title="CCCD Mặt trước"
                hasDoc={detail.has_id_card_front}
                attachment={detail.attachments?.id_card_front}
                uploading={uploadingKind === "id_card_front"}
                onUpload={(f) => onUploadDoc(detail.id, "id_card_front", f)}
                onDelete={() => onDeleteDoc(detail.id, "id_card_front")}
                onPreview={(att) => onPreview(att, `CCCD Mặt trước - ${detail.worker_name}`)}
              />
              <DocumentCard
                title="CCCD Mặt sau"
                hasDoc={detail.has_id_card_back}
                attachment={detail.attachments?.id_card_back}
                uploading={uploadingKind === "id_card_back"}
                onUpload={(f) => onUploadDoc(detail.id, "id_card_back", f)}
                onDelete={() => onDeleteDoc(detail.id, "id_card_back")}
                onPreview={(att) => onPreview(att, `CCCD Mặt sau - ${detail.worker_name}`)}
              />
              <DocumentCard
                title="Biên bản nghiệm thu hoàn thành"
                hasDoc={detail.has_acceptance}
                attachment={detail.attachments?.acceptance}
                uploading={uploadingKind === "acceptance"}
                onUpload={(f) => onUploadDoc(detail.id, "acceptance", f)}
                onDelete={() => onDeleteDoc(detail.id, "acceptance")}
                onPreview={(att) => onPreview(att, `Biên bản nghiệm thu - ${detail.contract_code}`)}
              />
              <DocumentCard
                title="Bản cam kết thuế TNCN (Mẫu 08)"
                hasDoc={detail.has_tax_commitment}
                attachment={detail.attachments?.tax_commitment}
                uploading={uploadingKind === "tax_commitment"}
                onUpload={(f) => onUploadDoc(detail.id, "tax_commitment", f)}
                onDelete={() => onDeleteDoc(detail.id, "tax_commitment")}
                onPreview={(att) => onPreview(att, `Bản cam kết thuế - ${detail.contract_code}`)}
              />
              <DocumentCard
                title="Ủy nhiệm chi (UNC) Techcombank (PDF hoặc Ảnh)"
                hasDoc={detail.has_bank_proof}
                attachment={detail.attachments?.bank_proof}
                uploading={uploadingKind === "bank_proof"}
                onUpload={(f) => onUploadDoc(detail.id, "bank_proof", f)}
                onDelete={() => onDeleteDoc(detail.id, "bank_proof")}
                onPreview={(att) =>
                  onPreview(att, `Ủy nhiệm chi Techcombank 79713 - ${detail.contract_code}`)
                }
              />

              <div className="ui-subpanel ui-subpanel--md ui-text-xs ui-stack--sm ui-row-between">
                <div className="ui-row ui-row-between">
                  <div className="ui-flex-1">
                    <div className="ui-text-strong ui-wrap">Ảnh hiện trường thi công</div>
                    <div className="pw-sub">Chụp rõ thiết bị, tủ điện hoặc Kiosk tại công trình</div>
                  </div>
                  <StatusBadge
                    size="sm"
                    tone={(detail.attachments?.site_photos?.length || 0) > 0 ? "success" : "danger"}
                    icon={(detail.attachments?.site_photos?.length || 0) > 0 ? "check" : "camera"}
                  >
                    {(detail.attachments?.site_photos?.length || 0) > 0
                      ? `Có ${detail.attachments?.site_photos?.length} ảnh`
                      : "Chưa có ảnh"}
                  </StatusBadge>
                </div>

                <label className="ui-btn ui-btn--primary ui-btn--sm pw-file">
                  <AppIcon name={uploadingKind === "site_photo" ? "loader" : "image"} size={14} />
                  <span>
                    {uploadingKind === "site_photo"
                      ? "Đang tải…"
                      : "Chọn ảnh từ thư viện / Tải tệp"}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    className="ui-hidden"
                    disabled={uploadingKind !== null}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      for (const f of files) {
                        await onUploadDoc(detail.id, "site_photo", f);
                      }
                    }}
                  />
                </label>

                {detail.attachments?.site_photos && detail.attachments.site_photos.length > 0 && (
                  <div className="ui-stack--sm">
                    {detail.attachments.site_photos.map((photo, idx) => (
                      <div key={photo.doc_id} className="pw-card ui-row">
                        {photo.is_pdf ? (
                          <AppButton
                            variant="secondary"
                            size="sm"
                            className="pw-pdf-box"
                            onClick={() =>
                              onPreview(photo, `Tệp hiện trường #${idx + 1} - ${detail.contract_code}`)
                            }
                            aria-label={`Xem tệp hiện trường #${idx + 1}`}
                          >
                            <AppIcon name="file-text" size={14} />
                            <span>PDF</span>
                          </AppButton>
                        ) : (
                          <img
                            src={photo.url}
                            alt={photo.label}
                            className="pw-thumb"
                            onClick={() =>
                              onPreview(photo, `Ảnh hiện trường #${idx + 1} - ${detail.contract_code}`)
                            }
                          />
                        )}
                        <div className="ui-flex-1">
                          <div className="ui-text-strong ui-wrap pw-clip">{photo.label}</div>
                          <div
                            className={
                              photo.validation?.valid ? "ui-text-xs ui-text-success" : "ui-text-xs ui-text-danger"
                            }
                          >
                            {photo.validation?.dimensions ||
                              (photo.validation?.valid ? "Hợp lệ" : "Lỗi tệp")}
                          </div>
                        </div>
                        <div className="ui-row ui-shrink-0">
                          <AppButton
                            variant="secondary"
                            size="sm"
                            iconOnly
                            leftIcon="eye"
                            aria-label="Xem ảnh phóng to"
                            title="Xem ảnh phóng to"
                            onClick={() =>
                              onPreview(photo, `Ảnh hiện trường #${idx + 1} - ${detail.contract_code}`)
                            }
                          />
                          <AppButton
                            variant="danger"
                            size="sm"
                            iconOnly
                            leftIcon="trash"
                            aria-label="Xóa ảnh này"
                            title="Xóa ảnh này"
                            onClick={() => onDeleteDoc(detail.id, "site_photo", photo.doc_id)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </FormGrid>
          </SectionCard>

          <SectionCard
            title="Lưu Trữ Google Drive Kế Toán Theo Quý"
            subtitle="Tự động phân loại theo thời điểm ký của HĐ vào thư mục Quý kế toán"
            icon="cloud-upload"
            padding="compact"
            tone="subtle"
            actions={
              detail.drive_synced_at ? (
                <StatusBadge tone="success" size="sm" icon="check-circle">
                  Đã đồng bộ: {formatDateTimeWithSeconds(detail.drive_synced_at)}
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning" size="sm" icon="clock">
                  Chưa đồng bộ Drive
                </StatusBadge>
              )
            }
          >
            <div className="ui-stack--sm">
              {detail.drive_folder && (
                <div className="pw-card ui-mono ui-wrap">{detail.drive_folder}</div>
              )}
              <div className="ui-row">
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="cloud-upload"
                  loading={syncingDriveId === detail.id}
                  onClick={() => onSyncDrive(detail)}
                >
                  {syncingDriveId === detail.id
                    ? "Đang sync Drive..."
                    : detail.drive_synced_at
                      ? "Đồng bộ lại lên Drive"
                      : "Đồng bộ lên Drive Kế toán"}
                </AppButton>

                {safeDriveHref && (
                  <a
                    href={safeDriveHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-btn ui-btn--primary ui-btn--sm"
                  >
                    <AppIcon name="external-link" size={14} />
                    <span>Mở Thư Mục Trên Google Drive</span>
                  </a>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </AppModal>
  );
}
