import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  api,
  DriveApiError,
  type DriveItem,
  type DrivePublicLockedResponse,
  type DrivePublicUnlockedResponse,
} from "../api";
import { DrivePreviewModal } from "../components/drive/DrivePreviewModal";
import { MediaLightbox } from "../components/drive/MediaLightbox";
import {
  classifyDriveItem,
  firePublicDriveTelemetry,
  formatBytes,
  formatDate,
  formatDateTime,
  getDriveItemBadge,
  getDriveItemIcon,
  isItemSignedPdf,
} from "../components/drive/driveUtils";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  InlineAlert,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  useToast,
} from "../components/ui";

type PublicFilter = "all" | "signed_pdf" | "image" | "video" | "other";

export function PublicDrive({ token }: { token: string }) {
  const toast = useToast();
  const pinInputId = useId();
  const telemetryFiredRef = useRef<string>("");
  const latestNonceRef = useRef<string>("");

  const [loading, setLoading] = useState(true);
  const [fatalErr, setFatalErr] = useState<{ status: number; message: string } | null>(null);
  const [lockedData, setLockedData] = useState<DrivePublicLockedResponse | null>(null);
  const [data, setData] = useState<DrivePublicUnlockedResponse | null>(null);
  const [currentSubId, setCurrentSubId] = useState<number | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);

  // Passcode gate state
  const [passcode, setPasscode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [pinError, setPinError] = useState("");
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  // Explorer UI state
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<PublicFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(-1);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setFatalErr(null);
    try {
      const res = await api.publicDriveGet(token);
      if (res.locked) {
        setLockedData(res);
        setData(null);
      } else {
        setLockedData(null);
        setData(res);
        setCurrentSubId(null);
        if (res.telemetry_nonce) {
          latestNonceRef.current = res.telemetry_nonce;
        }
      }
    } catch (ex) {
      const err = ex as DriveApiError | Error;
      const status = err instanceof DriveApiError ? err.status : 500;
      setFatalErr({
        status,
        message:
          status === 410
            ? "Liên kết chia sẻ đã hết hạn hoặc đã được thu hồi."
            : status === 404
              ? "Không tìm thấy bộ hồ sơ tương ứng với đường dẫn này."
              : err.message || "Không thể tải dữ liệu bộ hồ sơ.",
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  // Fire silent GeoIP telemetry once per session after unlocking
  useEffect(() => {
    if (!data || !data.telemetry_nonce) return;
    if (telemetryFiredRef.current === token) return;
    telemetryFiredRef.current = token;
    void firePublicDriveTelemetry(token, data.telemetry_nonce, "folder_open").then((nextNonce) => {
      if (nextNonce) latestNonceRef.current = nextNonce;
    });
  }, [data, token]);

  async function openSubfolder(subId: number | null) {
    if (subId == null) {
      await loadRoot();
      return;
    }
    setLoading(true);
    setFatalErr(null);
    try {
      const res = await api.publicDriveSubfolder(token, subId);
      setData(res);
      setCurrentSubId(subId);
      setSearch("");
      setTypeFilter("all");
      if (res.telemetry_nonce) latestNonceRef.current = res.telemetry_nonce;
    } catch (ex) {
      const err = ex as DriveApiError | Error;
      if (err instanceof DriveApiError && err.status === 401) {
        await loadRoot();
        return;
      }
      toast.error(err.message || "Không thể mở thư mục con.");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) {
      setPinError("Vui lòng nhập mã PIN để mở bộ hồ sơ.");
      return;
    }
    setUnlocking(true);
    setPinError("");
    try {
      await api.publicDriveUnlock(token, passcode.trim());
      setPasscode("");
      setRemainingAttempts(null);
      await loadRoot();
    } catch (ex) {
      const err = ex as DriveApiError | Error;
      if (err instanceof DriveApiError) {
        if (typeof err.remainingAttempts === "number") {
          setRemainingAttempts(err.remainingAttempts);
        }
        if (err.status === 429) {
          const mins = err.retryAfterSeconds
            ? Math.max(1, Math.ceil(err.retryAfterSeconds / 60))
            : 15;
          setPinError(
            `Bạn đã nhập sai mã PIN quá số lần cho phép. Vui lòng thử lại sau khoảng ${mins} phút.`,
          );
        } else {
          setPinError(err.message || "Mã PIN không chính xác.");
        }
      } else {
        setPinError(err.message || "Không thể xác thực mã PIN.");
      }
    } finally {
      setUnlocking(false);
    }
  }

  const canDownload = data ? data.share.permission !== "view_only" : false;
  const canZip = Boolean(data && canDownload && data.share.allow_zip_download);
  const logoSrc = data?.branding?.logo_url || lockedData?.branding?.logo_url || "/api/logo";
  const rootFolderId = data?.breadcrumbs?.[0]?.id ?? data?.folder?.id ?? null;

  const filteredItems = useMemo(() => {
    const list = data?.items || [];
    const q = search.trim().toLowerCase();
    return list.filter((item) => {
      if (q) {
        const hay = `${item.display_name} ${item.original_filename} ${item.note || ""} ${item.signer_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (typeFilter === "signed_pdf") return isItemSignedPdf(item);
      if (typeFilter === "image") return classifyDriveItem(item) === "image";
      if (typeFilter === "video") return classifyDriveItem(item) === "video";
      if (typeFilter === "other") {
        const c = classifyDriveItem(item);
        return c === "office" || c === "other" || (c === "pdf" && !isItemSignedPdf(item));
      }
      return true;
    });
  }, [data?.items, search, typeFilter]);

  const imageItems = useMemo(
    () => filteredItems.filter((it) => classifyDriveItem(it) === "image"),
    [filteredItems],
  );

  function openItem(item: DriveItem) {
    if (classifyDriveItem(item) === "image") {
      const idx = imageItems.findIndex((img) => img.id === item.id);
      if (idx >= 0) {
        setLightboxIdx(idx);
        return;
      }
    }
    setPreviewItem(item);
  }

  function renderBrandLogo() {
    if (logoBroken) {
      return (
        <span className="ui-inline ui-text-brand">
          <AppIcon name="shield-check" size={20} />
          <strong>INUT</strong>
        </span>
      );
    }
    return (
      <img
        src={logoSrc}
        alt="INUT"
        className="drive-pub-logo"
        onError={() => setLogoBroken(true)}
      />
    );
  }

  const zipUrl = api.publicDriveZipUrl(
    token,
    currentSubId != null && currentSubId !== rootFolderId ? currentSubId : null,
  );

  return (
    <div className="drive-pub ui-stack--xs" data-page="public-drive">
      <header className="drive-pub-bar ui-row-between">
        <div className="ui-row ui-row--md ui-flex-1">
          {renderBrandLogo()}
          <div className="ui-stack--xs ui-flex-1">
            <strong className="ui-text-semibold ui-truncate">Cổng Hồ Sơ Khách Hàng</strong>
            {(data?.folder.customer_name || lockedData?.customer_name) && (
              <span className="ui-muted ui-truncate">
                {data?.folder.customer_name || lockedData?.customer_name}
              </span>
            )}
          </div>
        </div>
        <div className="ui-row">
          {data?.share.expires_at && (
            <StatusBadge tone="neutral" icon="calendar" size="sm">
              Hạn {formatDate(data.share.expires_at)}
            </StatusBadge>
          )}
          {canZip && (
            <a className="ui-btn ui-btn--primary ui-btn--sm" href={zipUrl}>
              <AppIcon name="download" size={14} />
              <span>Tải toàn bộ (.zip)</span>
            </a>
          )}
        </div>
      </header>

      {/* Initial Loading Skeleton */}
      {loading && !data && !lockedData && !fatalErr && (
        <main className="ui-flex-1">
          <PageShell>
            <SkeletonBlock variant="title" />
            <SkeletonBlock variant="card" />
            <SkeletonBlock variant="line" lines={5} />
          </PageShell>
        </main>
      )}

      {/* Revoked / Expired / Not Found */}
      {fatalErr && (
        <main className="drive-pub-gate">
          <div className="ui-auth-card">
            <EmptyState
              icon="shield-alert"
              title={
                fatalErr.status === 410
                  ? "Liên kết chia sẻ đã hết hạn hoặc bị thu hồi"
                  : "Không thể truy cập bộ hồ sơ"
              }
              description={fatalErr.message}
              action={
                <AppButton variant="secondary" leftIcon="refresh" onClick={() => void loadRoot()}>
                  Thử tải lại
                </AppButton>
              }
            />
          </div>
        </main>
      )}

      {/* Passcode Gate */}
      {lockedData && !data && !fatalErr && (
        <main className="drive-pub-gate">
          <form className="ui-auth-card ui-stack" onSubmit={handleUnlock}>
            <div className="ui-stack--xs ui-text-center">
              <div className="ui-row-center">{renderBrandLogo()}</div>
              <span className="ui-kicker ui-mt-2">HỒ SƠ ĐƯỢC BẢO VỆ BẰNG MÃ PIN</span>
              <h1 className="ui-auth-title ui-wrap">{lockedData.folder_name}</h1>
              {lockedData.customer_name && (
                <div className="ui-row-center">
                  <StatusBadge tone="brand" icon="building-2" size="sm">
                    {lockedData.customer_name}
                  </StatusBadge>
                </div>
              )}
              {lockedData.expires_at && (
                <p className="ui-muted">Hiệu lực đến {formatDateTime(lockedData.expires_at)}</p>
              )}
            </div>

            <FormField label="Nhập mã PIN truy cập" htmlFor={pinInputId} required>
              <input
                id={pinInputId}
                type="password"
                inputMode="text"
                autoComplete="one-time-code"
                className="ui-input drive-pub-pin"
                value={passcode}
                placeholder="Nhập mã PIN…"
                autoFocus
                onChange={(e) => setPasscode(e.target.value)}
              />
            </FormField>

            {pinError && (
              <InlineAlert tone="danger">
                {pinError}
                {remainingAttempts !== null &&
                  remainingAttempts > 0 &&
                  !pinError.toLowerCase().includes("còn") && (
                    <> Còn lại {remainingAttempts} lần thử.</>
                  )}
              </InlineAlert>
            )}

            <AppButton
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              leftIcon="unlock"
              loading={unlocking}
            >
              Mở khóa hồ sơ
            </AppButton>
          </form>
        </main>
      )}

      {/* Unlocked Customer Drive Explorer */}
      {data && !fatalErr && (
        <main className="ui-flex-1">
          <PageShell>
            <PageHeader
              variant="compact"
              icon="folder-open"
              eyebrow={data.folder.project_code || "BỘ HỒ SƠ BÀN GIAO"}
              title={data.folder.name}
              subtitle={
                data.folder.description ||
                (data.share.label ? data.share.label : "Xem trực tiếp tài liệu ký số, ảnh minh chứng và video.")
              }
              badges={
                <>
                  {data.folder.customer_name && (
                    <StatusBadge tone="brand" icon="building-2" size="sm">
                      {data.folder.customer_name}
                    </StatusBadge>
                  )}
                  <StatusBadge tone="success" icon="shield-check" size="sm" className="num">
                    {data.stats.signed_pdfs} PDF ký số
                  </StatusBadge>
                  <StatusBadge tone="info" icon="image" size="sm" className="num">
                    {data.stats.images} ảnh
                  </StatusBadge>
                  <StatusBadge tone="brand" icon="video" size="sm" className="num">
                    {data.stats.videos} video
                  </StatusBadge>
                  {data.share.expires_at && (
                    <StatusBadge tone="warning" icon="clock" size="sm">
                      Hết hạn {formatDate(data.share.expires_at)}
                    </StatusBadge>
                  )}
                </>
              }
              actions={
                canZip ? (
                  <a className="ui-btn ui-btn--primary ui-btn--sm" href={zipUrl}>
                    <AppIcon name="archive" size={15} />
                    <span>Tải toàn bộ (.zip)</span>
                  </a>
                ) : (
                  <StatusBadge tone="neutral" icon="eye" size="sm">
                    Chế độ chỉ xem
                  </StatusBadge>
                )
              }
            />

            {/* Sticky Breadcrumb Bar */}
            {data.breadcrumbs.length > 0 && (
              <nav className="ui-sticky-bar ui-sticky-bar--top" aria-label="Đường dẫn thư mục">
                <ol className="ui-breadcrumbs-list">
                  {data.breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === data.breadcrumbs.length - 1;
                    return (
                      <li key={crumb.id} className="ui-breadcrumb-item">
                        {idx > 0 && (
                          <AppIcon name="chevron-right" size={12} className="ui-breadcrumb-sep" />
                        )}
                        {isLast ? (
                          <span className="ui-breadcrumb-current ui-wrap" aria-current="page">
                            {crumb.name}
                          </span>
                        ) : (
                          <AppButton
                            variant="ghost"
                            size="sm"
                            className="ui-wrap-btn"
                            onClick={() =>
                              void openSubfolder(idx === 0 ? null : crumb.id)
                            }
                          >
                            {crumb.name}
                          </AppButton>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}

            {/* Subfolders */}
            {data.subfolders.length > 0 && (
              <SectionCard
                padding="compact"
                icon="folder"
                title={`Danh mục hồ sơ (${data.subfolders.length})`}
              >
                <div className="ui-draft-grid">
                  {data.subfolders.map((sub) => (
                    <div key={sub.id} className="ui-draft-card">
                      <AppButton
                        variant="ghost"
                        className="ui-draft-open"
                        leftIcon="folder-open"
                        onClick={() => void openSubfolder(sub.id)}
                      >
                        <span className="ui-draft-open-inner">
                          <strong>{sub.name}</strong>
                          <span>
                            {sub.stats.total_items} tệp · {formatBytes(sub.stats.total_bytes)}
                          </span>
                        </span>
                      </AppButton>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Search, Filter Chips & Grid/List Toggle */}
            <FilterBar
              collapsibleMobile
              search={{
                value: search,
                onChange: setSearch,
                placeholder: "Tìm tên tài liệu, mã trạm…",
                ariaLabel: "Tìm tệp trong bộ hồ sơ",
              }}
              activeCount={(search.trim() ? 1 : 0) + (typeFilter !== "all" ? 1 : 0)}
              onReset={() => {
                setSearch("");
                setTypeFilter("all");
              }}
              filters={
                <div className="ui-row ui-row--xs">
                  {(
                    [
                      ["all", "Tất cả"],
                      ["signed_pdf", "PDF ký số"],
                      ["image", "Ảnh minh chứng"],
                      ["video", "Video"],
                    ] as const
                  ).map(([key, label]) => (
                    <AppButton
                      key={key}
                      variant={typeFilter === key ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setTypeFilter(key)}
                    >
                      {label}
                    </AppButton>
                  ))}
                </div>
              }
              actions={
                <div className="ui-row ui-row--xs">
                  <AppButton
                    variant={viewMode === "grid" ? "primary" : "secondary"}
                    size="sm"
                    iconOnly
                    leftIcon="grid"
                    aria-label="Hiển thị dạng lưới"
                    aria-pressed={viewMode === "grid"}
                    onClick={() => setViewMode("grid")}
                  />
                  <AppButton
                    variant={viewMode === "list" ? "primary" : "secondary"}
                    size="sm"
                    iconOnly
                    leftIcon="list"
                    aria-label="Hiển thị dạng danh sách"
                    aria-pressed={viewMode === "list"}
                    onClick={() => setViewMode("list")}
                  />
                </div>
              }
            />

            {/* Files Explorer */}
            {viewMode === "grid" ? (
              filteredItems.length === 0 ? (
                <EmptyState
                  icon="folder-open"
                  title={
                    data.subfolders.length > 0 && !search.trim() && typeFilter === "all"
                      ? "Chọn danh mục phía trên để xem tệp chi tiết"
                      : "Không có tệp nào khớp bộ lọc."
                  }
                  description={
                    search.trim() || typeFilter !== "all"
                      ? "Thử xóa bộ lọc hoặc nhập từ khóa khác."
                      : "Các tài liệu ký số, ảnh trạm và video được phân loại trong các danh mục thư mục."
                  }
                />
              ) : (
                <div className="ui-draft-grid">
                  {filteredItems.map((item) => {
                    const badge = getDriveItemBadge(item);
                    const cat = classifyDriveItem(item);
                    const thumb =
                      cat === "image"
                        ? item.thumb_url || api.publicDriveItemThumbUrl(token, item.id)
                        : null;
                    const dlUrl =
                      item.download_url || api.publicDriveItemDownloadUrl(token, item.id);
                    return (
                      <article key={item.id} className="drive-card ui-stack--xs">
                        <div className="drive-thumb ui-row-center ui-clickable" onClick={() => openItem(item)}>
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={item.display_name || item.original_filename}
                              loading="lazy"
                            />
                          ) : (
                            <AppIcon name={getDriveItemIcon(item)} size={36} />
                          )}
                        </div>
                        <div className="ui-stack--xs ui-pad-3 ui-flex-1">
                          <strong
                            className="ui-truncate"
                            title={item.display_name || item.original_filename}
                          >
                            {item.display_name || item.original_filename}
                          </strong>
                          <div className="ui-row ui-row--xs">
                            <StatusBadge tone={badge.tone} icon={badge.icon} size="sm">
                              {badge.label}
                            </StatusBadge>
                            <span className="ui-muted ui-mono">{formatBytes(item.file_size)}</span>
                          </div>
                        </div>
                        <div className="drive-cfoot ui-row-between">
                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="eye"
                            onClick={() => openItem(item)}
                          >
                            Xem trực tiếp
                          </AppButton>
                          {canDownload && (
                            <a
                              className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon-only"
                              href={dlUrl}
                              title="Tải tệp gốc"
                              aria-label={`Tải ${item.display_name || item.original_filename}`}
                            >
                              <AppIcon name="download" size={15} />
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            ) : (
              <DataView
                loading={loading}
                skeletonRows={5}
                skeletonCols={4}
                empty={
                  !loading && filteredItems.length === 0 ? (
                    <EmptyState
                      icon="folder-open"
                      title="Không có tệp nào khớp bộ lọc."
                      description="Chọn danh mục thư mục phía trên hoặc thử từ khóa khác."
                    />
                  ) : undefined
                }
                desktop={
                  <div className="ui-table-scroll-wrap">
                    <table className="ui-table ui-w-full">
                      <thead>
                        <tr>
                          <th>Tài liệu / Tệp</th>
                          <th>Loại & Trạng thái</th>
                          <th>Dung lượng</th>
                          <th className="col-act">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map((item) => {
                          const badge = getDriveItemBadge(item);
                          const dlUrl =
                            item.download_url || api.publicDriveItemDownloadUrl(token, item.id);
                          return (
                            <tr key={item.id}>
                              <td>
                                <AppButton
                                  variant="ghost"
                                  size="sm"
                                  leftIcon={getDriveItemIcon(item)}
                                  className="doc-fname-trigger"
                                  onClick={() => openItem(item)}
                                >
                                  {item.display_name || item.original_filename}
                                </AppButton>
                                {item.signer_name && (
                                  <div className="ui-muted">Người ký: {item.signer_name}</div>
                                )}
                              </td>
                              <td>
                                <StatusBadge tone={badge.tone} icon={badge.icon} size="sm">
                                  {badge.label}
                                </StatusBadge>
                              </td>
                              <td className="ui-mono nowrap">{formatBytes(item.file_size)}</td>
                              <td className="col-act">
                                <div className="ui-inline ui-row--nowrap">
                                  <AppButton
                                    variant="secondary"
                                    size="sm"
                                    leftIcon="eye"
                                    onClick={() => openItem(item)}
                                  >
                                    Xem
                                  </AppButton>
                                  {canDownload && (
                                    <a
                                      className="ui-btn ui-btn--primary ui-btn--sm"
                                      href={dlUrl}
                                    >
                                      <AppIcon name="download" size={14} />
                                      <span>Tải</span>
                                    </a>
                                  )}
                                </div>
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
                    {filteredItems.map((item) => {
                      const badge = getDriveItemBadge(item);
                      const dlUrl =
                        item.download_url || api.publicDriveItemDownloadUrl(token, item.id);
                      return (
                        <MobileCard key={item.id}>
                          <MobileCardHeader
                            title={<span className="ui-wrap">{item.display_name || item.original_filename}</span>}
                            subtitle={item.signer_name ? `Ký bởi ${item.signer_name}` : undefined}
                            badge={
                              <StatusBadge tone={badge.tone} icon={badge.icon} size="sm">
                                {badge.label}
                              </StatusBadge>
                            }
                          />
                          <MobileCardGrid cols={2}>
                            <MobileCardRow
                              label="Dung lượng"
                              value={formatBytes(item.file_size)}
                              mono
                            />
                            <MobileCardRow
                              label="Cập nhật"
                              value={formatDateTime(item.updated_at)}
                            />
                          </MobileCardGrid>
                          <MobileCardActions>
                            <AppButton
                              variant="secondary"
                              size="sm"
                              leftIcon="eye"
                              onClick={() => openItem(item)}
                            >
                              Xem trực tiếp
                            </AppButton>
                            {canDownload && (
                              <a className="ui-btn ui-btn--primary ui-btn--sm" href={dlUrl}>
                                <AppIcon name="download" size={14} />
                                <span>Tải xuống</span>
                              </a>
                            )}
                          </MobileCardActions>
                        </MobileCard>
                      );
                    })}
                  </div>
                }
              />
            )}
          </PageShell>
        </main>
      )}

      {/* Integrated Viewers */}
      <DrivePreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        viewUrl={
          previewItem
            ? previewItem.view_url || api.publicDriveItemViewUrl(token, previewItem.id)
            : ""
        }
        downloadUrl={
          previewItem
            ? previewItem.download_url || api.publicDriveItemDownloadUrl(token, previewItem.id)
            : ""
        }
        pdfFormatUrl={
          previewItem ? api.publicDriveItemViewUrl(token, previewItem.id, "pdf") : undefined
        }
        canDownload={canDownload}
        allowNeacVerify={Boolean(data?.share.allow_neac_verify)}
        onVerifyNeac={async (it) => api.publicDriveVerifyNeac(token, it.id)}
        onVideoPlay={(it) => {
          if (latestNonceRef.current) {
            void firePublicDriveTelemetry(
              token,
              latestNonceRef.current,
              "video_play",
              it.id,
            ).then((nextNonce) => {
              if (nextNonce) latestNonceRef.current = nextNonce;
            });
          }
        }}
      />

      <MediaLightbox
        images={imageItems}
        index={lightboxIdx}
        onChangeIndex={setLightboxIdx}
        onClose={() => setLightboxIdx(-1)}
        getViewUrl={(img) => img.view_url || api.publicDriveItemViewUrl(token, img.id)}
        getDownloadUrl={(img) =>
          img.download_url || api.publicDriveItemDownloadUrl(token, img.id)
        }
        canDownload={canDownload}
      />

      <footer className="drive-pub-foot ui-text-center ui-muted">
        <span>
          Cảm ơn Quý khách đã tin tưởng sử dụng dịch vụ của{" "}
          <a href="https://inut.vn" target="_blank" rel="noreferrer" className="ui-link">
            Công ty Cổ phần Đầu tư và Phát triển Công nghệ iNut (iNut JSC)
          </a>
        </span>
      </footer>
    </div>
  );
}
