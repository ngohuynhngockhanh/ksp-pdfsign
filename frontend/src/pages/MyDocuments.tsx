import { useEffect, useState } from "react";
import { api, DOC_TYPES, type DocRecord } from "../api";
import { copyText } from "../util";

export function MyDocuments({ onVerify }: { onVerify: (docPk: number) => void }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .myDocuments()
      .then(setDocs)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function share(id: number, filename: string) {
    const s = await api.createShare(id, 7, false);
    const exp = new Date(s.expires_at).toLocaleString("vi-VN");
    const text = `${filename}\n${s.url}\n(hết hạn ${exp})`;
    await copyText(text);
    window.alert("Đã tạo link & copy:\n\n" + text);
  }

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Hồ sơ của tôi <span className="count">{docs.length}</span>
        </h3>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Tên file</th>
              <th>Loại</th>
              <th className="col-hide-sm">Người ký</th>
              <th className="col-hide-sm">Thời gian</th>
              <th className="col-act"></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const k = d.doc_type || "";
              return (
                <tr key={d.id}>
                  <td className="fname">
                    <span className="ft">{d.filename}</span>
                    {d.signed_upload_name && (
                      <span className="chips">
                        <span className="chip indigo sm">📎 đã ký</span>
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={"badge tb-" + (k || "khac")}>{DOC_TYPES[k]}</span>
                  </td>
                  <td className="muted col-hide-sm">{d.signer_name}</td>
                  <td className="muted col-hide-sm nowrap">
                    {new Date(d.created_at).toLocaleString("vi-VN")}
                  </td>
                  <td className="col-act">
                    <div className="row-actions">
                      <a className="iact" href={d.download_url} title="Tải xuống">
                        ⬇
                      </a>
                      <button className="iact" onClick={() => share(d.id, d.filename)} title="Chia sẻ">
                        🔗
                      </button>
                      <button className="iact" onClick={() => onVerify(d.id)} title="Kiểm tra chữ ký">
                        ✔
                      </button>
                      {d.signed_upload_name && (
                        <a
                          className="iact"
                          href={api.signedFileUrl(d.id, true)}
                          target="_blank"
                          rel="noreferrer"
                          title="Xem bản đã ký"
                        >
                          📎
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && docs.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">
                    <div className="empty-ic">🗂️</div>
                    <div>Chưa có hồ sơ nào.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
