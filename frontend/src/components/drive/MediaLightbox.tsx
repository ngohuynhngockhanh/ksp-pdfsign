import { useEffect, useRef, useState } from "react";
import type { DriveItem } from "../../api";
import { AppButton, AppIcon, AppModal, StatusBadge } from "../ui";
import { formatBytes } from "./driveUtils";

export interface MediaLightboxProps {
  images: DriveItem[];
  index: number;
  onChangeIndex: (nextIndex: number) => void;
  onClose: () => void;
  getViewUrl: (item: DriveItem) => string;
  getDownloadUrl: (item: DriveItem) => string;
  canDownload?: boolean;
}

export function MediaLightbox({
  images,
  index,
  onChangeIndex,
  onClose,
  getViewUrl,
  getDownloadUrl,
  canDownload = true,
}: MediaLightboxProps) {
  const [zoomed, setZoomed] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const open = index >= 0 && index < images.length;
  const current = open ? images[index] : null;
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  useEffect(() => {
    setZoomed(false);
  }, [index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowLeft" && index > 0) {
        ev.preventDefault();
        onChangeIndex(index - 1);
      } else if (ev.key === "ArrowRight" && index < images.length - 1) {
        ev.preventDefault();
        onChangeIndex(index + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, images.length, onChangeIndex]);

  if (!current) return null;

  const dims =
    current.media_meta?.width && current.media_meta?.height
      ? `${current.media_meta.width}×${current.media_meta.height}`
      : null;
  const station = current.media_meta?.station_code
    ? `Trạm ${current.media_meta.station_code}`
    : null;
  const subtitle = [station, dims, formatBytes(current.file_size), current.note || null]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppModal
      open={open}
      onClose={onClose}
      size="full"
      className="ui-modal-preview"
      title={
        <span className="ui-inline ui-inline--md">
          <StatusBadge tone="info" icon="image" size="sm" className="num">
            {index + 1} / {images.length}
          </StatusBadge>
          <span className="ui-truncate">{current.display_name || current.original_filename}</span>
        </span>
      }
      subtitle={subtitle || undefined}
      footer={
        <div className="ui-modal-preview-footer">
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="chevron-left"
            disabled={!hasPrev}
            onClick={() => onChangeIndex(index - 1)}
          >
            Ảnh trước
          </AppButton>
          <AppButton
            variant="secondary"
            size="sm"
            rightIcon="chevron-right"
            disabled={!hasNext}
            onClick={() => onChangeIndex(index + 1)}
          >
            Ảnh tiếp
          </AppButton>
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon={zoomed ? "zoom-out" : "zoom-in"}
            onClick={() => setZoomed((z) => !z)}
          >
            {zoomed ? "Thu vừa khung" : "Phóng to 150%"}
          </AppButton>
          {canDownload && (
            <a className="ui-btn ui-btn--primary ui-btn--sm" href={getDownloadUrl(current)}>
              <AppIcon name="download" size={14} />
              <span>Tải ảnh gốc</span>
            </a>
          )}
          <AppButton variant="ghost" size="sm" onClick={onClose}>
            Đóng
          </AppButton>
        </div>
      }
    >
      <div
        className="drive-lb ui-row-center"
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          if (touchStartX.current == null || zoomed) return;
          const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
          touchStartX.current = null;
          if (dx > 50 && hasPrev) onChangeIndex(index - 1);
          else if (dx < -50 && hasNext) onChangeIndex(index + 1);
        }}
      >
        {hasPrev && (
          <AppButton
            variant="secondary"
            size="md"
            iconOnly
            leftIcon="chevron-left"
            className="drive-lb-nav drive-lb-prev"
            aria-label="Ảnh trước"
            onClick={() => onChangeIndex(index - 1)}
          />
        )}

        <img
          src={getViewUrl(current)}
          alt={current.display_name || current.original_filename}
          className={zoomed ? "drive-zoom" : "ui-preview-img ui-clickable"}
          onClick={() => setZoomed((z) => !z)}
        />

        {hasNext && (
          <AppButton
            variant="secondary"
            size="md"
            iconOnly
            leftIcon="chevron-right"
            className="drive-lb-nav drive-lb-next"
            aria-label="Ảnh tiếp theo"
            onClick={() => onChangeIndex(index + 1)}
          />
        )}
      </div>
    </AppModal>
  );
}
