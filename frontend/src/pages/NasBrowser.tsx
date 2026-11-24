import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  InlineAlert,
  MobileCard,
  MobileCardActions,
  MobileCardHeader,
  PageHeader,
  PageShell,
  StatusBadge,
  TableSkeleton,
  type PageHeaderBreadcrumb,
} from "../components/ui";
import { openExternalSafe, safeHttpUrl } from "../utils/url";

type Entry = { name: string; is_dir: boolean; size: number };

function fmtSize(n: number): string {
  if (n <= 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function NasBrowser() {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const requestId = useRef(0);

  function pathFromUrl() {
    return new URLSearchParams(window.location.search).get("path") || "";
  }

  function writePathToUrl(nextPath: string, mode: "push" | "replace") {
    const url = new URL(window.location.href);
    if (nextPath) url.searchParams.set("path", nextPath);
    else url.searchParams.delete("path");
    window.history[mode === "push" ? "pushState" : "replaceState"](
      { ...window.history.state, nasPath: nextPath },
      "",
      `${url.pathname}${url.search}`,
    );
  }

  async function load(p: string, historyMode: "push" | "replace" | "none" = "none") {
    const currentRequest = ++requestId.current;
    setBusy(true);
    setErr("");
    try {
      const r = await api.nasBrowse(p);
      if (currentRequest !== requestId.current) return;
      const nextPath = typeof r?.path === "string" ? r.path : "";
      setPath(nextPath);
      setEntries(Array.isArray(r?.entries) ? r.entries : []);
      if (historyMode !== "none") writePathToUrl(nextPath, historyMode);
    } catch (e) {
      if (currentRequest !== requestId.current) return;
      setErr((e as Error).message);
    } finally {
      if (currentRequest === requestId.current) setBusy(false);
    }
  }

  useEffect(() => {
    load(pathFromUrl(), "replace");
    const restoreFromHistory = () => load(pathFromUrl());
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, []);

  const parts = path ? path.split("\\") : [];
  function goTo(idx: number) {
    load(parts.slice(0, idx + 1).join("\\"), "push");
  }

  function open(e: Entry) {
    const child = path ? `${path}\\${e.name}` : e.name;
    if (e.is_dir) {
      load(child, "push");
    } else {
      const lower = e.name.toLowerCase();
      const canInline =
        lower.endsWith(".pdf") ||
        lower.endsWith(".docx") ||
        lower.endsWith(".md") ||
        lower.endsWith(".markdown");
      openExternalSafe(api.nasFileUrl(child, canInline));
    }
  }

  const breadcrumbs: PageHeaderBreadcrumb[] = [
    {
      label: "ho-so",
      onClick: path ? () => load("", "push") : undefined,
    },
    ...parts.map((part, i) => ({
      label: part,
      onClick: i < parts.length - 1 ? () => goTo(i) : undefined,
    })),
  ];

  const emptyNode =
    !busy && entries.length === 0 ? (
      <EmptyState
        icon="folder-open"
        title="Thư mục trống."
        description="Không có tệp tin hoặc thư mục con nào tại đường dẫn hiện tại."
        action={
          path ? (
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="arrow-up"
              onClick={() => goTo(parts.length - 2)}
            >
              Lên thư mục trên
            </AppButton>
          ) : undefined
        }
      />
    ) : undefined;

  return (
    <PageShell data-page="nas-browser">
      <PageHeader
        variant="compact"
        icon="hard-drive"
        eyebrow="INUT · NAS STORAGE"
        title="Duyệt kho lưu trữ NAS"
        subtitle={path ? `Đường dẫn: ho-so\\${path}` : "Thư mục gốc lưu trữ hồ sơ (ho-so)"}
        breadcrumbs={breadcrumbs}
        actions={
          <>
            {path && (
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="arrow-up"
                onClick={() => goTo(parts.length - 2)}
              >
                Thư mục trên
              </AppButton>
            )}
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="refresh"
              loading={busy}
              onClick={() => load(path, "none")}
            >
              Làm mới
            </AppButton>
          </>
        }
      />

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {busy && entries.length === 0 ? (
        <TableSkeleton rows={5} cols={3} />
      ) : (
        <DataView
          mobileMode="card"
          empty={emptyNode}
          desktop={
            <div className="ui-table-scroll-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th className="col-num nowrap">Kích thước</th>
                    <th className="col-act">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {path && (
                    <tr>
                      <td colSpan={3}>
                        <AppButton
                          variant="ghost"
                          size="sm"
                          leftIcon="arrow-up"
                          className="nas-entry-btn"
                          onClick={() => goTo(parts.length - 2)}
                        >
                          .. (lên thư mục trên)
                        </AppButton>
                      </td>
                    </tr>
                  )}
                  {entries.map((e) => {
                    const fullPath = path ? `${path}\\${e.name}` : e.name;
                    const viewHref = safeHttpUrl(api.nasFileUrl(fullPath, true));
                    const dlHref = safeHttpUrl(api.nasFileUrl(fullPath, false));
                    return (
                      <tr key={e.name}>
                        <td>
                          <AppButton
                            variant="ghost"
                            size="sm"
                            leftIcon={e.is_dir ? "folder" : "file-text"}
                            className={`nas-entry-btn${e.is_dir ? " is-dir" : ""}`}
                            onClick={() => open(e)}
                          >
                            {e.name}
                          </AppButton>
                        </td>
                        <td className="muted num nowrap">{fmtSize(e.size)}</td>
                        <td className="col-act">
                          {!e.is_dir && (
                            <div className="ui-inline ui-row--nowrap">
                              {viewHref && (
                                <a
                                  className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon-only"
                                  href={viewHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Xem"
                                  aria-label={`Xem ${e.name}`}
                                >
                                  <AppIcon name="eye" size={15} />
                                </a>
                              )}
                              {dlHref && (
                                <a
                                  className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon-only"
                                  href={dlHref}
                                  title="Tải"
                                  aria-label={`Tải ${e.name}`}
                                >
                                  <AppIcon name="download" size={15} />
                                </a>
                              )}
                            </div>
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
              {path && (
                <MobileCard>
                  <AppButton
                    variant="secondary"
                    size="sm"
                    fullWidth
                    leftIcon="arrow-up"
                    className="ui-wrap-btn"
                    onClick={() => goTo(parts.length - 2)}
                  >
                    .. (lên thư mục trên)
                  </AppButton>
                </MobileCard>
              )}
              {entries.map((e) => {
                const fullPath = path ? `${path}\\${e.name}` : e.name;
                const viewHref = safeHttpUrl(api.nasFileUrl(fullPath, true));
                const dlHref = safeHttpUrl(api.nasFileUrl(fullPath, false));
                return (
                  <MobileCard key={e.name}>
                    <MobileCardHeader
                      title={
                        <AppButton
                          variant="ghost"
                          size="sm"
                          leftIcon={e.is_dir ? "folder" : "file-text"}
                          className={`nas-entry-btn nas-entry-btn--card${e.is_dir ? " is-dir" : ""}`}
                          onClick={() => open(e)}
                        >
                          {e.name}
                        </AppButton>
                      }
                      badge={
                        !e.is_dir && e.size > 0 ? (
                          <StatusBadge tone="neutral" size="sm">
                            {fmtSize(e.size)}
                          </StatusBadge>
                        ) : e.is_dir ? (
                          <StatusBadge tone="brand" size="sm">
                            Thư mục
                          </StatusBadge>
                        ) : undefined
                      }
                    />
                    {!e.is_dir && (viewHref || dlHref) && (
                      <MobileCardActions>
                        {viewHref && (
                          <a
                            className="ui-btn ui-btn--secondary ui-btn--sm"
                            href={viewHref}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <AppIcon name="eye" size={15} />
                            <span>Xem</span>
                          </a>
                        )}
                        {dlHref && (
                          <a
                            className="ui-btn ui-btn--secondary ui-btn--sm"
                            href={dlHref}
                          >
                            <AppIcon name="download" size={15} />
                            <span>Tải về</span>
                          </a>
                        )}
                      </MobileCardActions>
                    )}
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      )}
    </PageShell>
  );
}
