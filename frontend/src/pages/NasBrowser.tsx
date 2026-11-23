import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DataView } from "../components/ui";
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
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  function pathFromUrl() {
    return new URLSearchParams(window.location.search).get("path") || "";
  }

  function writePathToUrl(nextPath: string, mode: "push" | "replace") {
    const url = new URL(window.location.href);
    if (nextPath) url.searchParams.set("path", nextPath);
    else url.searchParams.delete("path");
    window.history[mode === "push" ? "pushState" : "replaceState"](
      { ...window.history.state, nasPath: nextPath }, "", `${url.pathname}${url.search}`,
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
    if (e.is_dir) load(child, "push");
    else {
      const lower = e.name.toLowerCase();
      const canInline = lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".md") || lower.endsWith(".markdown");
      openExternalSafe(api.nasFileUrl(child, canInline));
    }
  }

  return (
    <div className="page-1col">
      <h3>Duyệt kho lưu trữ NAS</h3>
      <div className="crumbs">
        <button type="button" className="link-btn ui-btn-chip" onClick={() => load("", "push")}>
          🗄️ ho-so
        </button>
        {parts.map((p, i) => (
          <span key={i}>
            {" / "}
            <button type="button" className="link-btn ui-btn-chip" onClick={() => goTo(i)}>
              {p}
            </button>
          </span>
        ))}
      </div>
      {err && <div className="error">{err}</div>}
      {busy && <div className="muted">Đang tải…</div>}

      <DataView
        mobileMode="card"
        desktop={
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th className="nowrap">Kích thước</th>
                  <th className="col-act"></th>
                </tr>
              </thead>
              <tbody>
                {path && (
                  <tr>
                    <td colSpan={3}>
                      <button type="button" className="link-btn" onClick={() => goTo(parts.length - 2)}>
                        ⬆️ .. (lên thư mục trên)
                      </button>
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
                        <button type="button" className="link-btn nas-name" onClick={() => open(e)}>
                          {e.is_dir ? "📁" : "📄"} {e.name}
                        </button>
                      </td>
                      <td className="muted nowrap">{fmtSize(e.size)}</td>
                      <td className="col-act">
                        {!e.is_dir && (
                          <div className="row-actions">
                            {viewHref && (
                              <a
                                className="iact ui-btn-icon"
                                href={viewHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Xem"
                                aria-label={`Xem ${e.name}`}
                              >
                                👁
                              </a>
                            )}
                            {dlHref && (
                              <a
                                className="iact ui-btn-icon"
                                href={dlHref}
                                title="Tải"
                                aria-label={`Tải ${e.name}`}
                              >
                                ⬇
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!busy && entries.length === 0 && (
                  <tr>
                    <td colSpan={3}>
                      <div className="empty">
                        <div className="empty-ic">📂</div>
                        <div>Thư mục trống.</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        }
        mobileCards={
          <div className="ui-mobile-card-list">
            {path && (
              <div className="ui-mobile-card">
                <button
                  type="button"
                  className="link-btn ui-btn-chip"
                  style={{ width: "100%", justifyContent: "flex-start" }}
                  onClick={() => goTo(parts.length - 2)}
                >
                  ⬆️ .. (lên thư mục trên)
                </button>
              </div>
            )}
            {entries.map((e) => {
              const fullPath = path ? `${path}\\${e.name}` : e.name;
              const viewHref = safeHttpUrl(api.nasFileUrl(fullPath, true));
              const dlHref = safeHttpUrl(api.nasFileUrl(fullPath, false));
              return (
                <article key={e.name} className="ui-mobile-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <button
                      type="button"
                      className="link-btn nas-name"
                      style={{ textAlign: "left", wordBreak: "break-word", minWidth: 0, flex: 1, minHeight: 44 }}
                      onClick={() => open(e)}
                    >
                      {e.is_dir ? "📁" : "📄"} {e.name}
                    </button>
                    {!e.is_dir && e.size > 0 && (
                      <span className="chip sm gray nowrap">{fmtSize(e.size)}</span>
                    )}
                  </div>
                  {!e.is_dir && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      {viewHref && (
                        <a
                          className="btn-sm ui-btn-chip"
                          href={viewHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          👁 Xem
                        </a>
                      )}
                      {dlHref && (
                        <a
                          className="btn-sm ui-btn-chip"
                          href={dlHref}
                          style={{ textDecoration: "none" }}
                        >
                          ⬇ Tải về
                        </a>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {!busy && entries.length === 0 && (
              <div className="empty">
                <div className="empty-ic">📂</div>
                <div>Thư mục trống.</div>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
