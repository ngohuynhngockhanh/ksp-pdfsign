import { useState } from "react";
import { api, type CertInfo } from "../api";
import { parseDn } from "../util";

interface Props {
  ip: string;
  adminPassword: string;
  value: string;
  onChange: (certId: string) => void;
}

export function CertPicker({ ip, adminPassword, value, onChange }: Props) {
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.listCerts(ip, adminPassword);
      setCerts(r.certs);
      // Tự chọn chứng thư còn hạn đầu tiên
      const valid = r.certs.find((c) => new Date(c.valid_to) > new Date());
      if (valid && !value) onChange(valid.id);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cert-picker">
      <button type="button" onClick={load} disabled={busy}>
        {busy ? "Đang tải…" : "Lấy danh sách chứng thư"}
      </button>
      {err && <div className="error">{err}</div>}

      <div className="cert-list">
        {certs.map((c) => {
          const { cn, mst } = parseDn(c.subject);
          const ca = parseDn(c.issuer).cn;
          const expired = new Date(c.valid_to) <= new Date();
          return (
            <label key={c.id} className={"cert-card" + (value === c.id ? " selected" : "")}>
              <input
                type="radio"
                name="cert"
                checked={value === c.id}
                onChange={() => onChange(c.id)}
              />
              <div className="cert-body">
                <div className="cert-cn">
                  {cn}
                  {expired ? (
                    <span className="badge red">Hết hạn</span>
                  ) : (
                    <span className="badge green">Còn hạn</span>
                  )}
                </div>
                <div className="cert-meta">
                  {mst && (
                    <span>
                      <b>MST:</b> {mst}
                    </span>
                  )}
                  <span>
                    <b>CA:</b> {ca}
                  </span>
                </div>
                <div className="cert-meta">
                  <span>
                    <b>Hiệu lực:</b> {c.valid_from.slice(0, 10)} → {c.valid_to.slice(0, 10)}
                  </span>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
