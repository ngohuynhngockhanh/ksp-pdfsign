import { useId } from "react";
import type {
  PieceworkCertificateInfo,
  PieceworkContractItem,
} from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  FormField,
  FormGrid,
  InlineAlert,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import { openExternalSafe, safeHttpUrl } from "../../utils/url";
import type {
  DriveSyncModalState,
  PreviewDocState,
  ShareModalState,
} from "./helpers";

export interface SigningModalProps {
  contract: PieceworkContractItem | null;
  signMode: "contract_date" | "realtime";
  customSignDate: string;
  certificates: PieceworkCertificateInfo[];
  selectedCertId: string;
  certPin: string;
  certLoading: boolean;
  submitting: boolean;
  onChangeSignMode: (mode: "contract_date" | "realtime") => void;
  onChangeCustomSignDate: (value: string) => void;
  onChangeCertId: (certId: string) => void;
  onChangeCertPin: (pin: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function SigningModal({
  contract,
  signMode,
  customSignDate,
  certificates,
  selectedCertId,
  certPin,
  certLoading,
  submitting,
  onChangeSignMode,
  onChangeCustomSignDate,
  onChangeCertId,
  onChangeCertPin,
  onConfirm,
  onClose,
}: SigningModalProps) {
  const uid = useId();
  const contractDateRadioId = `${uid}-sign-contract-date`;
  const realtimeRadioId = `${uid}-sign-realtime`;
  const customDateId = `${uid}-custom-sign-date`;
  const pinInputId = `${uid}-cert-pin`;

  return (
    <AppModal
      open={Boolean(contract)}
      onClose={onClose}
      size="md"
      title="Ký Số Điện Tử Bên A (INUT)"
      subtitle={
        contract ? (
          <>
            HĐ số: <b>{contract.contract_code}</b> · {contract.worker_name}
          </>
        ) : undefined
      }
      footer={
        contract && (
          <>
            <AppButton variant="secondary" onClick={onClose} disabled={submitting}>
              Hủy
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="check-circle"
              loading={submitting}
              onClick={onConfirm}
            >
              {submitting ? "Đang ký số…" : "Xác nhận Ký số INUT"}
            </AppButton>
          </>
        )
      }
    >
      {contract && (
        <div className="ui-stack">
          <div className="ui-stack--sm">
            <div className="ui-kicker ui-text-brand">1. Lựa chọn chứng thư ký số doanh nghiệp</div>
            {certLoading ? (
              <SkeletonBlock variant="line" lines={3} />
            ) : certificates.length === 0 ? (
              <InlineAlert tone="warning">
                Sử dụng chứng thư số mặc định của INUT (MST: 4401053694)
              </InlineAlert>
            ) : (
              <div className="ui-stack--sm ui-scroll-sm">
                {certificates.map((cert) => {
                  const certSubject = cert.subject.includes("CN=")
                    ? cert.subject.split("CN=")[1].split(",")[0]
                    : cert.subject;
                  const certIssuer = cert.issuer.includes("CN=")
                    ? cert.issuer.split("CN=")[1].split(",")[0]
                    : cert.issuer;
                  return (
                    <label
                      key={cert.id}
                      className={`ui-choice-card${selectedCertId === cert.id ? " is-on" : ""}`}
                    >
                      <input
                        type="radio"
                        name="certChoice"
                        value={cert.id}
                        checked={selectedCertId === cert.id}
                        onChange={() => onChangeCertId(cert.id)}
                      />
                      <div className="ui-flex-1">
                        <div className="ui-text-strong ui-wrap">{certSubject}</div>
                        <div className="pw-sub">
                          <span>
                            Nhà cấp (CA): <b>{certIssuer}</b> ·{" "}
                          </span>
                          <span className={cert.expired ? "ui-text-xs ui-text-danger" : "ui-text-xs ui-text-success"}>
                            {cert.expired
                              ? "Hết hạn"
                              : `Còn hạn đến ${cert.valid_to ? cert.valid_to.slice(0, 10) : ""}`}
                          </span>
                        </div>
                        <div className="pw-sub">
                          Serial: <span className="ui-mono ui-wrap">{cert.serial || cert.id.slice(0, 16)}...</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="ui-stack--sm">
            <div className="ui-kicker ui-text-brand">2. Mốc thời gian ký mật mã (/M)</div>

            <div className={`ui-choice-card${signMode === "contract_date" ? " is-on" : ""}`}>
              <input
                id={contractDateRadioId}
                type="radio"
                name="signMode"
                value="contract_date"
                checked={signMode === "contract_date"}
                onChange={() => onChangeSignMode("contract_date")}
              />
              <div className="ui-flex-1 ui-stack--sm">
                <label htmlFor={contractDateRadioId} className="ui-text-strong ui-wrap">
                  Theo ngày trên hợp đồng khoán (
                  {customSignDate ? customSignDate.replace("T", " ") : contract.contract_date}) — Mặc
                  định khuyên dùng (có giây lẻ)
                </label>
                <div className="pw-sub">
                  Khớp ngày ký với ngày trên hợp đồng khoán và thời hạn nghiệm thu để đảm bảo chứng từ
                  thuế hợp lệ.
                </div>
                {signMode === "contract_date" && (
                  <FormField
                    label="Tùy chỉnh ngày giờ ký (nếu cần đổi mốc giờ)"
                    htmlFor={customDateId}
                  >
                    <input
                      id={customDateId}
                      type="datetime-local"
                      step="1"
                      className="ui-input"
                      value={customSignDate}
                      onChange={(e) => onChangeCustomSignDate(e.target.value)}
                    />
                  </FormField>
                )}
              </div>
            </div>

            <label className={`ui-choice-card${signMode === "realtime" ? " is-on" : ""}`}>
              <input
                id={realtimeRadioId}
                type="radio"
                name="signMode"
                value="realtime"
                checked={signMode === "realtime"}
                onChange={() => onChangeSignMode("realtime")}
              />
              <div className="ui-flex-1">
                <div className="ui-text-strong ui-wrap">Ký theo thời gian thực hiện tại (Realtime)</div>
                <div className="pw-sub">
                  Sử dụng mốc thời gian hệ thống chuẩn tại thời điểm bấm ký.
                </div>
              </div>
            </label>
          </div>

          <FormField label="Mã PIN USB Token (Mặc định: 12345678)" htmlFor={pinInputId}>
            <input
              id={pinInputId}
              type="password"
              className="ui-input"
              value={certPin}
              onChange={(e) => onChangeCertPin(e.target.value)}
            />
          </FormField>
        </div>
      )}
    </AppModal>
  );
}

export interface ShareContractModalProps {
  shareModal: ShareModalState | null;
  copiedShare: boolean;
  onChangeTab: (tab: "signed" | "unsigned" | "portal") => void;
  onCopyUrl: (url: string) => void;
  onShareNativeFallback: (shareMessage: string) => void;
  onClose: () => void;
}

export function ShareContractModal({
  shareModal,
  copiedShare,
  onChangeTab,
  onCopyUrl,
  onShareNativeFallback,
  onClose,
}: ShareContractModalProps) {
  const c = shareModal?.contract;
  const isSignedTab = shareModal?.tab === "signed";
  const isDraftTab = shareModal?.tab === "unsigned";
  const isPortalTab = shareModal?.tab === "portal";

  const activeUrl = c
    ? isPortalTab
      ? `${window.location.origin}/khoan/${c.portal_token}`
      : `${window.location.origin}/api/public/khoan/${c.portal_token}/pdf${isDraftTab ? "?signed=0" : "?signed=1"}`
    : "";

  const shareTitle = c
    ? isPortalTab
      ? `Link ký online Hợp đồng khoán ${c.contract_code} - iNut`
      : isSignedTab
        ? `Hợp đồng giao khoán ĐÃ KÝ SỐ ${c.contract_code} - iNut`
        : `Bản thảo Hợp đồng giao khoán CHƯA KÝ ${c.contract_code} - iNut`
    : "";

  const shareMessage = c
    ? isPortalTab
      ? `Kính gửi anh/chị ${c.worker_name}, iNut gửi link ký trực tuyến Hợp đồng giao khoán ${c.contract_code} (${c.project_name}). Vui lòng bấm vào liên kết sau để xem và ký tên xác thực: ${activeUrl}`
      : isSignedTab
        ? `Kính gửi anh/chị ${c.worker_name}, iNut gửi tệp PDF Hợp đồng giao khoán ${c.contract_code} ĐÃ KÝ SỐ CHÍNH THỨC (${c.project_name}, số tiền: ${c.total_amount?.toLocaleString("vi-VN")} đ). Tải file PDF tại: ${activeUrl}`
        : `Kính gửi anh/chị ${c.worker_name}, iNut gửi Bản thảo Hợp đồng giao khoán ${c.contract_code} (${c.project_name}) để xem trước và đối soát điều khoản. Xem file PDF tại: ${activeUrl}`
    : "";

  return (
    <AppModal
      open={Boolean(shareModal)}
      onClose={onClose}
      size="md"
      title={c ? c.contract_code : ""}
      subtitle={
        c ? (
          <>
            Thợ: <b>{c.worker_name}</b> · {c.project_name}
          </>
        ) : undefined
      }
      footer={
        <AppButton variant="secondary" onClick={onClose}>
          Đóng
        </AppButton>
      }
    >
      {shareModal && c && (
        <div className="ui-stack">
          <div>
            <StatusBadge tone="brand" icon="share">
              Chia Sẻ Hợp Đồng & Tệp PDF
            </StatusBadge>
          </div>

          <div className="pw-share-tabs">
            <AppButton
              variant={isSignedTab ? "primary" : "secondary"}
              size="sm"
              leftIcon="file-check"
              onClick={() => onChangeTab("signed")}
            >
              PDF ĐÃ KÝ SỐ
            </AppButton>
            <AppButton
              variant={isDraftTab ? "gold" : "secondary"}
              size="sm"
              leftIcon="file-text"
              onClick={() => onChangeTab("unsigned")}
            >
              PDF BẢN THẢO (CHƯA KÝ)
            </AppButton>
            <AppButton
              variant={isPortalTab ? "primary" : "secondary"}
              size="sm"
              leftIcon="link"
              onClick={() => onChangeTab("portal")}
            >
              LINK KÝ ONLINE
            </AppButton>
          </div>

          {isSignedTab && (
            <InlineAlert tone="success" title="Phiên bản: ĐÃ KÝ SỐ CHÍNH THỨC">
              Tệp PDF chứa đầy đủ chữ ký số điện tử của iNut (PAdES) và chữ ký tay eKYC của thợ. Đủ
              điều kiện làm chứng từ thuế.
            </InlineAlert>
          )}
          {isDraftTab && (
            <InlineAlert tone="warning" title="Phiên bản: BẢN THẢO CHƯA KÝ (DỰ THẢO)">
              Tệp PDF sạch chưa đóng dấu, phù hợp để gửi thợ hoặc đối tác duyệt trước điều khoản và
              đơn giá công việc.
            </InlineAlert>
          )}
          {isPortalTab && (
            <InlineAlert tone="info" title="Phiên bản: LIÊN KẾT KÝ TRỰC TUYẾN (PORTAL DI ĐỘNG)">
              Mở giao diện ký online hỗ trợ vẽ tay trên màn hình cảm ứng và chụp ảnh khuôn mặt eKYC
              chống chối bỏ.
            </InlineAlert>
          )}

          <div className="ui-row pw-url-row">
            <input
              type="text"
              readOnly
              className="ui-input"
              aria-label="Đường dẫn chia sẻ"
              value={activeUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <AppButton
              variant="primary"
              leftIcon={copiedShare ? "check" : "copy"}
              onClick={() => onCopyUrl(activeUrl)}
            >
              {copiedShare ? "Đã Chép" : "Sao Chép"}
            </AppButton>
          </div>

          <FormGrid cols={2}>
            <AppButton
              variant="primary"
              fullWidth
              leftIcon="message-square"
              onClick={() => {
                const zaloShare = `https://zalo.me/share?url=${encodeURIComponent(activeUrl)}&message=${encodeURIComponent(shareMessage)}`;
                openExternalSafe(zaloShare);
              }}
            >
              Gửi qua Zalo
            </AppButton>

            <AppButton
              variant="danger"
              fullWidth
              leftIcon="mail"
              onClick={() => {
                const mailto = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareMessage)}`;
                window.location.href = mailto;
              }}
            >
              Gửi qua Email
            </AppButton>

            <AppButton
              variant="gold"
              fullWidth
              leftIcon="share"
              onClick={async () => {
                if (navigator.share) {
                  try {
                    await navigator.share({
                      title: shareTitle,
                      text: shareMessage,
                      url: activeUrl,
                    });
                    return;
                  } catch (err: unknown) {
                    if (err instanceof Error && err.name !== "AbortError") {
                      console.warn(err);
                    }
                  }
                }
                onShareNativeFallback(shareMessage);
              }}
            >
              Chia Sẻ Điện Thoại
            </AppButton>

            <a
              href={safeHttpUrl(activeUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn--secondary ui-btn--md ui-btn--full"
            >
              <AppIcon name="external-link" size={16} />
              <span>Mở Xem Trực Tiếp</span>
            </a>
          </FormGrid>
        </div>
      )}
    </AppModal>
  );
}

export function DriveSyncResultModal({
  driveSyncModal,
  onClose,
}: {
  driveSyncModal: DriveSyncModalState | null;
  onClose: () => void;
}) {
  const safeDriveHref = driveSyncModal ? safeHttpUrl(driveSyncModal.drive_link) : "";

  return (
    <AppModal
      open={Boolean(driveSyncModal)}
      onClose={onClose}
      size="md"
      title={driveSyncModal ? `Đồng Bộ Thành Công (${driveSyncModal.quarter})` : ""}
      subtitle={
        driveSyncModal ? (
          <>
            Hợp đồng: <b>{driveSyncModal.contract_code}</b>
          </>
        ) : undefined
      }
      footer={
        driveSyncModal && (
          <>
            <AppButton variant="secondary" onClick={onClose}>
              Đóng
            </AppButton>
            {safeDriveHref && (
              <a
                href={safeDriveHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-btn ui-btn--primary ui-btn--md"
              >
                <AppIcon name="external-link" size={16} />
                <span>Mở Thư Mục Trên Google Drive</span>
              </a>
            )}
          </>
        )
      }
    >
      {driveSyncModal && (
        <div className="ui-stack">
          <div>
            <StatusBadge tone="success" icon="cloud-upload">
              Google Drive Kế Toán
            </StatusBadge>
          </div>

          <div className="ui-stack--sm">
            <div className="pw-sub">Thư mục đích trên Google Drive:</div>
            <div className="pw-card ui-mono ui-wrap">{driveSyncModal.remote_dest}</div>
          </div>

          <div className="ui-stack--sm">
            <div className="ui-text-strong ui-wrap">
              Danh sách tệp hồ sơ đã đồng bộ ({driveSyncModal.files.length} tệp):
            </div>
            <div className="ui-stack--sm ui-scroll-sm">
              {driveSyncModal.files.map((fn, idx) => (
                <div key={idx} className="pw-card ui-row">
                  <AppIcon
                    name={fn.endsWith(".pdf") ? "file-text" : fn.endsWith(".docx") ? "file-badge" : "image"}
                    size={15}
                  />
                  <span className="ui-mono ui-wrap ui-flex-1">{fn}</span>
                  <StatusBadge tone="success" size="sm" icon="check">
                    Đã tải lên
                  </StatusBadge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppModal>
  );
}

export function DocumentPreviewModal({
  previewDoc,
  onClose,
}: {
  previewDoc: PreviewDocState | null;
  onClose: () => void;
}) {
  const safeDownloadHref = previewDoc ? safeHttpUrl(previewDoc.downloadUrl) : "";
  const safeDocHref = previewDoc ? safeHttpUrl(previewDoc.url) : "";

  return (
    <AppModal
      open={Boolean(previewDoc)}
      onClose={onClose}
      size="lg"
      title={previewDoc?.title ?? "Xem tài liệu"}
      subtitle={previewDoc?.validationNote}
      footer={
        previewDoc && (
          <>
            {safeDownloadHref && (
              <a
                href={safeDownloadHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-btn ui-btn--secondary ui-btn--md"
              >
                <AppIcon name="download" size={16} />
                <span>Tải file</span>
              </a>
            )}
            <AppButton variant="primary" onClick={onClose}>
              Đóng
            </AppButton>
          </>
        )
      }
    >
      {previewDoc && (
        <div className="ui-preview-stage">
          {previewDoc.isPdf ? (
            <iframe
              src={safeDocHref}
              title={previewDoc.title}
              className="pw-frame"
            />
          ) : (
            <img
              src={previewDoc.url}
              alt={previewDoc.title}
              className="ui-preview-img"
            />
          )}
        </div>
      )}
    </AppModal>
  );
}
