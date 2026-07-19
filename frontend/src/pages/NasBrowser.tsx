import { useEffect, useState } from "react";
import { api } from "../api";

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

  async function load(p: string) {
    setBusy(true);
    setErr("");
    try {
      const r = await api.nasBrowse(p);
      setPath(r.path);
      setEntries(r.entries);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load("");
  }, []);

  const parts = path ? path.split("\\") : [];
  function goTo(idx: number) {
    load(parts.slice(0, idx + 1).join("\\"));
  }
  function open(e: Entry) {
    const child = path ? `${path}\\${e.name}` : e.name;
    if (e.is_dir) load(child);
    else {
      const isPdf = e.name.toLowerCase().endsWith(".pdf");
      window.open(api.nasFileUrl(child, isPdf), "_blank");
    }
  }

  return (
    <div className="page-1col">
      <h3>🗄️ Duyệt NAS</h3>
      <div className="crumbs">
        <button className="link-btn" onClick={() => load("")}>
          inut
        </button>
        {parts.map((p, i) => (
          <span key={i}>
            {" / "}
            <button className="link-btn" onClick={() => goTo(i)}>
              {p}
            </button>
          </span>
        ))}
      </div>
      {err && <div className="error">{err}</div>}
      {busy && <div className="muted">Đang tải…</div>}

      <table className="doc-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Kích thước</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {path && (
            <tr>
              <td colSpan={3}>
                <button className="link-btn" onClick={() => goTo(parts.length - 2)}>
                  ⬆️ .. (lên thư mục trên)
                </button>
              </td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.name}>
              <td>
                <button className="link-btn" onClick={() => open(e)}>
                  {e.is_dir ? "📁" : "📄"} {e.name}
                </button>
              </td>
              <td className="muted">{fmtSize(e.size)}</td>
              <td className="actions">
                {!e.is_dir && (
                  <>
                    <a href={api.nasFileUrl(path ? `${path}\\${e.name}` : e.name, true)} target="_blank" rel="noreferrer">
                      Xem
                    </a>
                    <a href={api.nasFileUrl(path ? `${path}\\${e.name}` : e.name, false)}>Tải</a>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!busy && entries.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                Thư mục trống.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
