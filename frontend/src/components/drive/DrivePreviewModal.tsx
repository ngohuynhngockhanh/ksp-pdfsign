import { useEffect, useState } from "react";
import type { DriveItem, DriveNeacVerifyResponse, SignatureReport } from "../../api";
import { PdfView } from "../PdfView";
import {
  AppButton,
  AppIcon,
  AppModal,
  InlineAlert,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "../ui";
import {
  classifyDriveItem,
  formatBytes,
  formatDateTime,
  getDriveItemBadge,
  getItemExt,
  isItemSignedPdf,
} from "./driveUtils";

export interface DrivePreviewModalProps {
  item: DriveItem | null;
  onClose: () => void;
  viewUrl: string;
  downloadUrl: string;
  pdfFormatUrl?: string;
  canDownload?: boolean;
  allowNeacVerify?: boolean;
  onVerifyNeac?: (item: DriveItem) => Promise<DriveNeacVerifyResponse>;
  onVideoPlay?: (item: DriveItem) => void;
}

export function DrivePreviewModal({
  item,
  onClose,
  viewUrl,
  downloadUrl,
  pdfFormatUrl,
  canDownload = true,
  allowNeacVerify = false,
  onVerifyNeac,
  onVideoPlay,
}: DrivePreviewModalProps) {
  const [pdfMode, setPdfMode] = useState<"iframe" | "canvas">(() =>
    typeof window !== "undefined" && window.innerWidth <= 820 ? "canvas" : "iframe",
  );
  const [neacOpen, setNeacOpen] = useState(false);
  const [neacBusy, setNeacBusy] = useState(false);
  const [neacErr, setNeacErr] = useState("");
  const [neacData, setNeacData] = useState<DriveNeacVerifyResponse | null>(null);

  useEffect(() => {
    setNeacOpen(false);
    setNeacBusy(false);
    setNeacErr("");
    setNeacData(null);
  }, [item?.id]);

  if (!item) return null;

  const category = classifyDriveItem(item);
  const ext = getItemExt(item);
  const badge = getDriveItemBadge(item);
  const signedPdf = isItemSignedPdf(item);

  async function runNeacVerify() {
    if (!item || !onVerifyNeac) return;
    setNeacOpen(true);
    setNeacBusy(true);
    setNeacErr("");
    setNeacData(null);
    try {
      const res = await onVerifyNeac(item);
      setNeacData(res);
    } catch (e) {
      setNeacErr((e as Error).message || "Không thể thẩm định chữ ký số lúc này.");
    } finally {
      setNeacBusy(false);
    }
  }

  return (
    <>
      <AppModal
        open={Boolean(item)}
        onClose={onClose}
        size="full"
        className="ui-modal-preview"
        title={
          <span className="ui-inline ui-inline--md">
            <StatusBadge tone={badge.tone} icon={badge.icon} size="sm">
              {badge.label}
            </StatusBadge>
            <span className="ui-truncate">{item.display_name || item.original_filename}</span>
          </span>
        }
        subtitle={
          [
            formatBytes(item.file_size),
            item.signer_name ? `Người ký: ${item.signer_name}` : null,
            item.note || null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        footer={
          <div className="ui-modal-preview-footer">
            {category === "pdf" && (
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon={pdfMode === "iframe" ? "file-search" : "file-text"}
                onClick={() => setPdfMode((m) => (m === "iframe" ? "canvas" : "iframe"))}
              >
                {pdfMode === "iframe" ? "Chế độ PDF.js" : "Chế độ trình duyệt"}
              </AppButton>
            )}
            {category === "pdf" && allowNeacVerify && onVerifyNeac && (
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="shield-check"
                loading={neacBusy}
                onClick={runNeacVerify}
              >
                Thẩm định chữ ký số NEAC
              </AppButton>
            )}
            {category === "office" && pdfFormatUrl && (
              <a
                className="ui-btn ui-btn--secondary ui-btn--sm"
                href={pdfFormatUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <AppIcon name="file-text" size={14} />
                <span>Bản in PDF</span>
              </a>
            )}
            {(category === "pdf" || category === "office") && (
              <a
                className="ui-btn ui-btn--secondary ui-btn--sm"
                href={viewUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <AppIcon name="external-link" size={14} />
                <span>Mở tab mới</span>
              </a>
            )}
            {canDownload && (
              <a className="ui-btn ui-btn--primary ui-btn--sm" href={downloadUrl}>
                <AppIcon name="download" size={14} />
                <span>Tải xuống</span>
              </a>
            )}
            <AppButton variant="ghost" size="sm" onClick={onClose}>
              Đóng
            </AppButton>
          </div>
        }
      >
        {category === "pdf" && (
          <div className="ui-stack ui-flex-1">
            {signedPdf && (
              <div className="ui-pad-3">
                <InlineAlert
                  tone="success"
                  title="Tài liệu đã được ký số hợp lệ"
                  action={
                    allowNeacVerify && onVerifyNeac ? (
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="shield-check"
                        loading={neacBusy}
                        onClick={runNeacVerify}
                      >
                        Thẩm định chữ ký số NEAC
                      </AppButton>
                    ) : undefined
                  }
                >
                  {item.signer_name
                    ? `Chủ thể ký: ${item.signer_name}.`
                    : "Bấm thẩm định để kiểm tra tính toàn vẹn mật mã và chứng thư số trên cổng NEAC."}
                </InlineAlert>
              </div>
            )}
            {pdfMode === "canvas" ? (
              <PdfView url={viewUrl} />
            ) : (
              <iframe
                className="doc-preview-frame"
                src={viewUrl}
                title={item.display_name || item.original_filename}
              />
            )}
          </div>
        )}

        {category === "video" && (
          <div className="ui-pad-3 ui-stack">
            <video
              className="drive-video"
              controls
              playsInline
              preload="metadata"
              src={viewUrl}
              onPlay={() => onVideoPlay?.(item)}
            />
            <div className="ui-row-between">
              <span className="ui-muted">
                Video MP4 phát trực tuyến chuẩn HTTP Range · {formatBytes(item.file_size)}
              </span>
              {canDownload && (
                <a className="ui-btn ui-btn--secondary ui-btn--sm" href={downloadUrl}>
                  <AppIcon name="download" size={14} />
                  <span>Tải video gốc</span>
                </a>
              )}
            </div>
          </div>
        )}

        {category === "office" && (
          <iframe
            className="doc-preview-frame"
            src={viewUrl}
            title={item.display_name || item.original_filename}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        )}

        {category === "other" && (
          <div className="ui-pad-3">
            <SectionCard
              icon="file-text"
              title={item.display_name || item.original_filename}
              subtitle={`Định dạng ${ext || item.mime_type || "tệp"} · ${formatBytes(item.file_size)}`}
            >
              <div className="ui-stack--sm">
                <div className="ui-kv-row">
                  <span>Tên tệp gốc</span>
                  <strong>{item.original_filename}</strong>
                </div>
                <div className="ui-kv-row">
                  <span>Dung lượng</span>
                  <strong className="ui-mono">{formatBytes(item.file_size)}</strong>
                </div>
                {item.sha256 && (
                  <div className="ui-kv-row">
                    <span>Mã băm SHA-256</span>
                    <strong className="ui-mono">{item.sha256.slice(0, 24)}…</strong>
                  </div>
                )}
                <div className="ui-kv-row">
                  <span>Cập nhật</span>
                  <strong>{formatDateTime(item.updated_at)}</strong>
                </div>
              </div>
            </SectionCard>
          </div>
        )}
      </AppModal>

      <AppModal
        open={neacOpen}
        onClose={() => setNeacOpen(false)}
        size="md"
        title="Thẩm định chữ ký số NEAC"
        subtitle={item.display_name || item.original_filename}
        footer={
          <>
            {neacData?.neac_portal_url && (
              <a
                className="ui-btn ui-btn--secondary ui-btn--sm"
                href={neacData.neac_portal_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <AppIcon name="external-link" size={14} />
                <span>Cổng Quốc gia NEAC</span>
              </a>
            )}
            <AppButton variant="primary" size="sm" onClick={() => setNeacOpen(false)}>
              Đóng
            </AppButton>
          </>
        }
      >
        {neacBusy && (
          <div className="ui-stack" role="status" aria-busy="true">
            <SkeletonBlock variant="title" />
            <SkeletonBlock variant="line" lines={5} />
            <p className="ui-muted">
              Đang đối chiếu tính toàn vẹn PAdES, chuỗi chứng thư CA và cổng NEAC…
            </p>
          </div>
        )}
        {neacErr && <InlineAlert tone="danger">{neacErr}</InlineAlert>}
        {neacData && !neacBusy && <NeacResultPanel data={neacData} />}
      </AppModal>
    </>
  );
}

function NeacResultPanel({ data }: { data: DriveNeacVerifyResponse }) {
  const iv = data.internal_verification;
  const intSigs: SignatureReport[] = Array.isArray(iv?.signatures) ? iv.signatures : [];
  const firstInt = intSigs[0] ?? null;
  const neacSig = data.neac_result?.signature?.data?.[0];

  const hasSig = Boolean(firstInt);
  const isCryptValid = Boolean(
    hasSig && firstInt.valid && firstInt.intact && firstInt.trusted && iv?.valid,
  );
  const isRevoked = Boolean(hasSig && firstInt.revocation_ok === false);
  const hasWarn = Boolean(
    hasSig &&
      (firstInt.revocation_ok === null ||
        firstInt.revocation_ok === undefined ||
        (firstInt.problems && firstInt.problems.length > 0)),
  );

  let tone: "success" | "warning" | "danger" = "danger";
  let verdict = "Chữ ký số không hợp lệ";
  if (!hasSig) {
    verdict = "Tài liệu không chứa chữ ký số";
  } else if (isRevoked) {
    verdict = "Chứng thư số đã bị thu hồi";
  } else if (!isCryptValid) {
    verdict =
      firstInt.intact && firstInt.valid && !firstInt.trusted
        ? "Chữ ký chưa thuộc chuỗi CA tin cậy"
        : "Chữ ký không hợp lệ hoặc tài liệu đã bị thay đổi";
  } else if (hasWarn) {
    tone = "warning";
    verdict = firstInt.summary || "Hợp lệ mật mã (có lưu ý OCSP/CRL)";
  } else {
    tone = "success";
    verdict = "Chữ ký số hợp lệ & toàn vẹn 100%";
  }

  const signerName = neacSig?.signer?.cn || firstInt?.signer_name || "Không xác định";
  const issuerName = neacSig?.issuer?.cn
    ? `${neacSig.issuer.cn}${neacSig.issuer.o ? ` (${neacSig.issuer.o})` : ""}`
    : firstInt?.certificate_issuer || "Không xác định";
  const signedTime = neacSig?.signedTime || formatDateTime(firstInt?.signing_time) || "—";
  const ocspStatus =
    neacSig?.ocsp ||
    (!hasSig
      ? "Không có chữ ký"
      : firstInt?.revocation_ok === true
        ? "Chứng thư hợp lệ, chưa bị thu hồi"
        : firstInt?.revocation_ok === false
          ? "Chứng thư đã bị thu hồi"
          : "Chưa kiểm tra được OCSP/CRL ngoại tuyến");

  return (
    <div className="ui-stack">
      <InlineAlert tone={tone} title={verdict}>
        {data.verified_at ? `Thời điểm thẩm định: ${data.verified_at}` : "Đã hoàn tất đối chiếu."}
      </InlineAlert>

      <div className="ui-subpanel ui-stack--xs">
        <div className="ui-kv-row">
          <span>Chủ thể ký</span>
          <strong>{signerName}</strong>
        </div>
        <div className="ui-kv-row">
          <span>Tổ chức cấp CA</span>
          <strong>{issuerName}</strong>
        </div>
        <div className="ui-kv-row">
          <span>Tính toàn vẹn dữ liệu</span>
          <strong className={firstInt?.intact ? "ui-text-success" : "ui-text-danger"}>
            {!hasSig
              ? "Không có chữ ký"
              : firstInt?.intact
                ? "Toàn vẹn (không sửa sau ký)"
                : "Không toàn vẹn"}
          </strong>
        </div>
        <div className="ui-kv-row">
          <span>Thời điểm ký số</span>
          <strong className="ui-mono">{signedTime}</strong>
        </div>
        <div className="ui-kv-row">
          <span>Trạng thái chứng thư (OCSP/CRL)</span>
          <strong>{ocspStatus}</strong>
        </div>
        <div className="ui-kv-row">
          <span>Số chữ ký trong tài liệu</span>
          <strong className="ui-mono">{intSigs.length}</strong>
        </div>
      </div>

      {firstInt?.problems && firstInt.problems.length > 0 && (
        <InlineAlert tone="warning" title="Chi tiết cần lưu ý">
          <ul className="ui-bullet-list ui-text-xs">
            {firstInt.problems.map((p, idx) => (
              <li key={idx}>{p}</li>
            ))}
          </ul>
        </InlineAlert>
      )}
    </div>
  );
}
