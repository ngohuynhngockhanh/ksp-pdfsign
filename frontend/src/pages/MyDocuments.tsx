import { useEffect, useState } from "react";
import { api, type DocRecord } from "../api";
import { copyText } from "../util";

export function MyDocuments({ onVerify }: { onVerify: (docPk: number) => void }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .myDocuments()
      .then(setDocs)
      .catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <div className="page-1col">
      <h3>Hồ sơ của tôi ({docs.length})</h3>
      {err && <div className="error">{err}</div>}
      <table className="doc-table">
        <thead>
          <tr>
            <th>Tên file</th>
            <th>Người ký</th>
            <th>Thời gian</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.filename}</td>
              <td className="muted">{d.signer_name}</td>
              <td className="muted">{new Date(d.created_at).toLocaleString("vi-VN")}</td>
              <td className="actions">
                <a href={d.download_url}>⬇️ Tải</a>
                <button
                  className="link-btn"
                  onClick={async () => {
                    const s = await api.createShare(d.id, 7, false);
                    const exp = new Date(s.expires_at).toLocaleString("vi-VN");
                    const text = `${s.filename}\n${s.url}\n(hết hạn ${exp})`;
                    await copyText(text);
                    window.alert("Đã tạo link & copy:\n\n" + text);
                  }}
                >
                  Chia sẻ
                </button>
                <button className="link-btn" onClick={() => onVerify(d.id)}>
                  Kiểm tra
                </button>
              </td>
            </tr>
          ))}
          {docs.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                Chưa có hồ sơ nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
