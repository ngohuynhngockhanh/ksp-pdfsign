import { useEffect, useId, useState, type FormEvent } from "react";
import {
  api,
  type DriveAccessLogItem,
  type DriveFolderSummary,
  type DriveShare,
} from "../../api";
import { copyText } from "../../util";
import {
  AppButton,
  AppIcon,
  DataView,
  DetailDrawer,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  ResponsiveTabs,
  SectionCard,
  StatusBadge,
  useConfirm,
  useToast,
} from "../ui";
import {
  buildHandoverMessage,
  DRIVE_ACCESS_ACTION_LABEL,
  formatDateTime,
} from "./driveUtils";

export interface FolderShareModalProps {
  open: boolean;
  folder: DriveFolderSummary | null;
  shares: DriveShare[];
  onClose: () => void;
  onSharesChanged: () => void;
}

export function FolderShareModal({
  open,
  folder,
  shares,
  onClose,
  onSharesChanged,
}: FolderShareModalProps) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const labelId = useId();
  const permId = useId();
  const expModeId = useId();
  const expDateId = useId();
  const pinId = useId();
  const maxViewsId = useId();

  const [activeTab, setActiveTab] = useState<"shares" | "logs">("shares");
  const [label, setLabel] = useState("");
  const [permission, setPermission] = useState<"view_download" | "view_only">("view_download");
  const [usePasscode, setUsePasscode] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [expMode, setExpMode] = useState<"30" | "7" | "90" | "never" | "custom">("30");
  const [customExpDate, setCustomExpDate] = useState("");
  const [maxViews, setMaxViews] = useState("");
  const [allowZip, setAllowZip] = useState(true);
  const [allowNeac, setAllowNeac] = useState(true);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [notifyTelegram, setNotifyTelegram] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyShareId, setBusyShareId] = useState<number | null>(null);
  const [qrOpenId, setQrOpenId] = useState<number | null>(null);
  const [recentPinByShare, setRecentPinByShare] = useState<Record<number, string>>({});

  // Access logs state
  const [logs, setLogs] = useState<DriveAccessLogItem[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsErr, setLogsErr] = useState("");

  useEffect(() => {
    if (!open || !folder) return;
    setLabel(folder.customer_name ? `Gửi ${folder.customer_name}` : "");
    setActiveTab("shares");
    setQrOpenId(null);
    setLogsPage(1);
  }, [open, folder?.id]);

  useEffect(() => {
    if (!open || !folder || activeTab !== "logs") return;
    let cancelled = false;
    setLogsLoading(true);
    setLogsErr("");
    api
      .driveAccessLogs(folder.id, { page: logsPage, pageSize: 30 })
      .then((res) => {
        if (cancelled) return;
        setLogs(res.items || []);
        setLogsTotal(res.total || 0);
      })
      .catch((e) => {
        if (!cancelled) setLogsErr((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, folder?.id, activeTab, logsPage]);

  if (!folder) return null;

  function resolveShareUrl(s: DriveShare): string {
    if (s.share_url && /^https?:\/\//i.test(s.share_url)) return s.share_url;
    const rel = s.public_path || `/d/${s.token}`;
    return typeof window !== "undefined" ? `${window.location.origin}${rel}` : rel;
  }

  async function handleCreateShare(e: FormEvent) {
    e.preventDefault();
    if (!folder) return;
    if (usePasscode && passcode.trim().length < 4) {
      toast.warning("Mã PIN bảo vệ cần ít nhất 4 ký tự.");
      return;
    }
    setCreating(true);
    try {
      const payload: Parameters<typeof api.driveCreateShare>[1] = {
        label: label.trim() || `Chia sẻ ${folder.name}`,
        permission,
        allow_zip_download: permission === "view_only" ? false : allowZip,
        allow_neac_verify: allowNeac,
        include_subfolders: includeSubfolders,
        notify_telegram: notifyTelegram,
      };
      if (usePasscode && passcode.trim()) {
        payload.passcode = passcode.trim();
      }
      if (expMode === "custom" && customExpDate) {
        payload.expires_at = `${customExpDate}T23:59:59`;
      } else if (expMode !== "never") {
        payload.expires_days = Number(expMode);
      }
      if (maxViews.trim()) {
        const mv = Number(maxViews);
        if (Number.isFinite(mv) && mv > 0) payload.max_views = Math.floor(mv);
      }
      const created = await api.driveCreateShare(folder.id, payload);
      if (usePasscode && passcode.trim()) {
        setRecentPinByShare((prev) => ({ ...prev, [created.id]: passcode.trim() }));
      }
      setPasscode("");
      setUsePasscode(false);
      setQrOpenId(created.id);
      await copyText(resolveShareUrl(created));
      toast.success("Đã tạo liên kết chia sẻ và sao chép vào clipboard.");
      onSharesChanged();
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleShareFlag(
    s: DriveShare,
    patch: Partial<Parameters<typeof api.driveUpdateShare>[1]>,
    okMsg: string,
  ) {
    setBusyShareId(s.id);
    try {
      await api.driveUpdateShare(s.id, patch);
      toast.success(okMsg);
      onSharesChanged();
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setBusyShareId(null);
    }
  }

  async function handleRevoke(s: DriveShare) {
    const ok = await confirmDialog({
      title: "Thu hồi liên kết chia sẻ",
      message: `Liên kết "${s.label || s.token}" sẽ lập tức ngừng hoạt động (trả 410 Gone). Bạn chắc chắn muốn thu hồi?`,
      confirmLabel: "Thu hồi liên kết",
      tone: "danger",
    });
    if (!ok) return;
    setBusyShareId(s.id);
    try {
      await api.driveRevokeShare(s.id);
      toast.success("Đã thu hồi liên kết chia sẻ.");
      onSharesChanged();
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setBusyShareId(null);
    }
  }

  const totalLogPages = Math.max(1, Math.ceil(logsTotal / 30));

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      size="lg"
      title={`Chia sẻ · ${folder.name}`}
      subtitle={
        [folder.customer_name || null, folder.project_code || null].filter(Boolean).join(" · ") ||
        "Quản lý liên kết khách hàng, mã QR và nhật ký truy cập"
      }
    >
      <div className="ui-stack">
        <ResponsiveTabs
          active={activeTab}
          onChange={(id) => setActiveTab(id as "shares" | "logs")}
          tabs={[
            { id: "shares", label: "Liên kết chia sẻ", icon: "share", badge: shares.length },
            { id: "logs", label: "Nhật ký truy cập", icon: "activity", badge: logsTotal || undefined },
          ]}
        />

        {activeTab === "shares" && (
          <div className="ui-stack">
            <SectionCard
              padding="compact"
              icon="link"
              title="Tạo liên kết chia sẻ mới (/d/…)"
              subtitle="Khách hàng mở xem trực tiếp mà không cần tài khoản quản trị."
            >
              <form className="ui-stack" onSubmit={handleCreateShare}>
                <FormGrid cols={2}>
                  <FormField label="Nhãn liên kết" htmlFor={labelId}>
                    <input
                      id={labelId}
                      className="ui-input"
                      value={label}
                      placeholder="VD: Gửi Ban Giám đốc Việt Hùng Power"
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Quyền truy cập" htmlFor={permId}>
                    <select
                      id={permId}
                      className="ui-select"
                      value={permission}
                      onChange={(e) => {
                        const v = e.target.value as "view_download" | "view_only";
                        setPermission(v);
                        if (v === "view_only") setAllowZip(false);
                      }}
                    >
                      <option value="view_download">Xem & Tải xuống</option>
                      <option value="view_only">Chỉ xem trực tuyến</option>
                    </select>
                  </FormField>
                  <FormField label="Thời hạn hiệu lực" htmlFor={expModeId}>
                    <select
                      id={expModeId}
                      className="ui-select"
                      value={expMode}
                      onChange={(e) => setExpMode(e.target.value as typeof expMode)}
                    >
                      <option value="7">7 ngày</option>
                      <option value="30">30 ngày (khuyến nghị)</option>
                      <option value="90">90 ngày</option>
                      <option value="never">Không giới hạn</option>
                      <option value="custom">Chọn ngày cụ thể</option>
                    </select>
                  </FormField>
                  {expMode === "custom" ? (
                    <FormField label="Ngày hết hạn" htmlFor={expDateId}>
                      <input
                        id={expDateId}
                        type="date"
                        className="ui-input"
                        value={customExpDate}
                        onChange={(e) => setCustomExpDate(e.target.value)}
                      />
                    </FormField>
                  ) : (
                    <FormField label="Giới hạn lượt mở (để trống = không giới hạn)" htmlFor={maxViewsId}>
                      <input
                        id={maxViewsId}
                        type="number"
                        min={1}
                        className="ui-input"
                        value={maxViews}
                        placeholder="VD: 50"
                        onChange={(e) => setMaxViews(e.target.value)}
                      />
                    </FormField>
                  )}
                </FormGrid>

                <div className="ui-row">
                  <label className="ui-check-label">
                    <input
                      type="checkbox"
                      checked={usePasscode}
                      onChange={(e) => setUsePasscode(e.target.checked)}
                    />
                    <span>Bảo vệ bằng mã PIN</span>
                  </label>
                  <label className="ui-check-label">
                    <input
                      type="checkbox"
                      checked={allowZip}
                      disabled={permission === "view_only"}
                      onChange={(e) => setAllowZip(e.target.checked)}
                    />
                    <span>Cho tải trọn bộ (.zip)</span>
                  </label>
                  <label className="ui-check-label">
                    <input
                      type="checkbox"
                      checked={allowNeac}
                      onChange={(e) => setAllowNeac(e.target.checked)}
                    />
                    <span>Cho thẩm định NEAC</span>
                  </label>
                  <label className="ui-check-label">
                    <input
                      type="checkbox"
                      checked={includeSubfolders}
                      onChange={(e) => setIncludeSubfolders(e.target.checked)}
                    />
                    <span>Bao gồm thư mục con</span>
                  </label>
                  <label className="ui-check-label">
                    <input
                      type="checkbox"
                      checked={notifyTelegram}
                      onChange={(e) => setNotifyTelegram(e.target.checked)}
                    />
                    <span>Báo Telegram khi khách xem</span>
                  </label>
                </div>

                {usePasscode && (
                  <FormField
                    label="Mã PIN truy cập (tối thiểu 4 ký tự)"
                    htmlFor={pinId}
                    required
                  >
                    <input
                      id={pinId}
                      type="text"
                      className="ui-input ui-mono"
                      value={passcode}
                      placeholder="Nhập mã PIN cho đối tác…"
                      onChange={(e) => setPasscode(e.target.value)}
                    />
                  </FormField>
                )}

                <div className="ui-row-end">
                  <AppButton
                    type="submit"
                    variant="primary"
                    size="sm"
                    leftIcon="share"
                    loading={creating}
                  >
                    Tạo liên kết chia sẻ
                  </AppButton>
                </div>
              </form>
            </SectionCard>

            {shares.length === 0 ? (
              <EmptyState
                compact
                icon="share"
                title="Chưa có liên kết chia sẻ nào."
                description="Tạo liên kết phía trên để gửi bộ hồ sơ và mã QR cho khách hàng."
              />
            ) : (
              <div className="ui-stack">
                {shares.map((s) => {
                  const fullUrl = resolveShareUrl(s);
                  const isActive = !s.revoked && !s.expired;
                  const busy = busyShareId === s.id;
                  const qrUrl = s.qr_svg_url || api.driveShareQrUrl(s.id);
                  return (
                    <SectionCard
                      key={s.id}
                      padding="compact"
                      title={s.label || `Liên kết #${s.id}`}
                      subtitle={`Tạo lúc ${formatDateTime(s.created_at)} · ${s.view_count} lượt mở`}
                      actions={
                        <StatusBadge
                          tone={s.revoked ? "danger" : s.expired ? "warning" : "success"}
                          icon={s.revoked ? "ban" : s.expired ? "clock" : "check-circle"}
                          size="sm"
                        >
                          {s.revoked ? "Đã thu hồi" : s.expired ? "Hết hạn" : "Đang hoạt động"}
                        </StatusBadge>
                      }
                    >
                      <div className="ui-stack--sm">
                        <div className="ui-row">
                          <code className="ui-code ui-flex-1">{fullUrl}</code>
                        </div>

                        <div className="ui-row">
                          <StatusBadge tone="neutral" size="sm" icon={s.permission === "view_only" ? "eye" : "download"}>
                            {s.permission === "view_only" ? "Chỉ xem" : "Xem & Tải"}
                          </StatusBadge>
                          {s.has_passcode && (
                            <StatusBadge tone="brand" size="sm" icon="lock">
                              Có mã PIN
                            </StatusBadge>
                          )}
                          {s.allow_zip_download && (
                            <StatusBadge tone="info" size="sm" icon="archive">
                              Cho tải ZIP
                            </StatusBadge>
                          )}
                          {s.notify_telegram && (
                            <StatusBadge tone="success" size="sm" icon="bell">
                              Telegram
                            </StatusBadge>
                          )}
                          <StatusBadge tone="neutral" size="sm" icon="calendar">
                            {s.expires_at ? `Hạn ${formatDateTime(s.expires_at)}` : "Không giới hạn"}
                          </StatusBadge>
                        </div>

                        <div className="ui-row">
                          <AppButton
                            variant="primary"
                            size="sm"
                            leftIcon="copy"
                            onClick={async () => {
                              await copyText(fullUrl);
                              toast.success("Đã sao chép đường dẫn chia sẻ.");
                            }}
                          >
                            Sao chép link
                          </AppButton>
                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="message-square"
                            onClick={async () => {
                              const msg = buildHandoverMessage({
                                folderName: folder.name,
                                customerName: folder.customer_name,
                                url: fullUrl,
                                passcode: recentPinByShare[s.id],
                                expiresAt: s.expires_at,
                              });
                              await copyText(msg);
                              toast.success("Đã sao chép lời nhắn bàn giao tiếng Việt.");
                            }}
                          >
                            Copy tin bàn giao
                          </AppButton>
                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="qr-code"
                            onClick={() => setQrOpenId((cur) => (cur === s.id ? null : s.id))}
                          >
                            {qrOpenId === s.id ? "Ẩn QR" : "Mã QR"}
                          </AppButton>
                          <a
                            className="ui-btn ui-btn--ghost ui-btn--sm"
                            href={fullUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <AppIcon name="external-link" size={14} />
                            <span>Mở thử</span>
                          </a>
                          {isActive && (
                            <>
                              <AppButton
                                variant="ghost"
                                size="sm"
                                leftIcon="archive"
                                loading={busy}
                                onClick={() =>
                                  toggleShareFlag(
                                    s,
                                    { allow_zip_download: !s.allow_zip_download },
                                    s.allow_zip_download ? "Đã tắt tải ZIP." : "Đã bật tải ZIP.",
                                  )
                                }
                              >
                                {s.allow_zip_download ? "Tắt ZIP" : "Bật ZIP"}
                              </AppButton>
                              <AppButton
                                variant="ghost"
                                size="sm"
                                leftIcon="bell"
                                loading={busy}
                                onClick={() =>
                                  toggleShareFlag(
                                    s,
                                    { notify_telegram: !s.notify_telegram },
                                    s.notify_telegram
                                      ? "Đã tắt báo Telegram."
                                      : "Đã bật báo Telegram.",
                                  )
                                }
                              >
                                {s.notify_telegram ? "Tắt Telegram" : "Bật Telegram"}
                              </AppButton>
                              <AppButton
                                variant="danger"
                                size="sm"
                                leftIcon="ban"
                                loading={busy}
                                onClick={() => handleRevoke(s)}
                              >
                                Thu hồi
                              </AppButton>
                            </>
                          )}
                        </div>

                        {qrOpenId === s.id && (
                          <div className="ui-subpanel ui-row">
                            <div className="drive-qr ui-row-center">
                              <img src={qrUrl} alt={`Mã QR ${s.label || folder.name}`} />
                            </div>
                            <div className="ui-stack--xs ui-flex-1">
                              <strong className="ui-text-semibold">Mã QR truy cập nhanh</strong>
                              <p className="ui-muted">
                                Khách hàng quét mã QR trên biên bản in giấy hoặc điện thoại để mở
                                trực tiếp bộ hồ sơ nghiệm thu.
                              </p>
                              <div>
                                <a
                                  className="ui-btn ui-btn--secondary ui-btn--sm"
                                  href={qrUrl}
                                  download={`qr-${folder.slug || folder.id}.svg`}
                                >
                                  <AppIcon name="download" size={14} />
                                  <span>Tải QR (.svg)</span>
                                </a>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </SectionCard>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "logs" && (
          <div className="ui-stack">
            <div className="ui-row-between">
              <span className="ui-muted">
                Tổng cộng <strong className="ui-mono">{logsTotal}</strong> lượt truy cập
              </span>
              <a
                className="ui-btn ui-btn--secondary ui-btn--sm"
                href={api.driveAccessLogsCsvUrl(folder.id)}
              >
                <AppIcon name="download" size={14} />
                <span>Xuất CSV chứng từ</span>
              </a>
            </div>

            {logsErr && <InlineAlert tone="danger">{logsErr}</InlineAlert>}

            <DataView
              loading={logsLoading}
              skeletonRows={5}
              skeletonCols={5}
              empty={
                !logsLoading && logs.length === 0 ? (
                  <EmptyState
                    compact
                    icon="activity"
                    title="Chưa có lượt truy cập nào."
                    description="Mọi lượt mở thư mục, xem/tải tệp và thẩm định NEAC từ khách hàng sẽ được ghi nhận tại đây."
                  />
                ) : undefined
              }
              desktop={
                <div className="ui-table-scroll-wrap">
                  <table className="ui-table ui-w-full">
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Hành động</th>
                        <th>Tệp</th>
                        <th>IP & Vị trí</th>
                        <th>Thiết bị</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => {
                        const meta = DRIVE_ACCESS_ACTION_LABEL[log.action] ?? {
                          label: log.action,
                          tone: "neutral" as const,
                        };
                        const geo = [log.city, log.region, log.isp].filter(Boolean).join(" · ");
                        return (
                          <tr key={log.id}>
                            <td className="ui-mono nowrap">{formatDateTime(log.created_at)}</td>
                            <td>
                              <StatusBadge tone={meta.tone} size="sm">
                                {meta.label}
                              </StatusBadge>
                            </td>
                            <td className="ui-wrap">{log.item_name || "—"}</td>
                            <td>
                              <div className="ui-mono">{log.ip || "—"}</div>
                              {geo && <div className="ui-muted">{geo}</div>}
                            </td>
                            <td>{log.device_type || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              }
              mobileCards={
                <div className="ui-mobile-card-list">
                  {logs.map((log) => {
                    const meta = DRIVE_ACCESS_ACTION_LABEL[log.action] ?? {
                      label: log.action,
                      tone: "neutral" as const,
                    };
                    const geo = [log.city, log.region, log.isp].filter(Boolean).join(" · ");
                    return (
                      <MobileCard key={log.id}>
                        <MobileCardHeader
                          title={log.item_name || "Truy cập thư mục"}
                          subtitle={formatDateTime(log.created_at)}
                          badge={
                            <StatusBadge tone={meta.tone} size="sm">
                              {meta.label}
                            </StatusBadge>
                          }
                        />
                        <MobileCardGrid cols={2}>
                          <MobileCardRow label="IP" value={log.ip || "—"} mono />
                          <MobileCardRow label="Thiết bị" value={log.device_type || "—"} />
                          {geo && <MobileCardRow label="Vị trí / ISP" value={geo} fullWidth />}
                        </MobileCardGrid>
                      </MobileCard>
                    );
                  })}
                </div>
              }
            />

            {totalLogPages > 1 && (
              <nav className="ui-pager" aria-label="Phân trang nhật ký truy cập">
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="chevron-left"
                  disabled={logsPage <= 1}
                  onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                >
                  Trước
                </AppButton>
                <span className="ui-muted ui-mono">
                  Trang {logsPage}/{totalLogPages}
                </span>
                <AppButton
                  variant="secondary"
                  size="sm"
                  rightIcon="chevron-right"
                  disabled={logsPage >= totalLogPages}
                  onClick={() => setLogsPage((p) => Math.min(totalLogPages, p + 1))}
                >
                  Sau
                </AppButton>
              </nav>
            )}
          </div>
        )}
      </div>
    </DetailDrawer>
  );
}
