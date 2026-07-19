import { useState } from "react";
import { api, type CertInfo } from "../api";

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
      if (r.certs.length && !value) onChange(r.certs[0].id);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cert-picker">
      <div className="row">
        <button type="button" onClick={load} disabled={busy}>
          {busy ? "Đang tải…" : "Lấy danh sách chứng thư"}
        </button>
      </div>
      {err && <div className="error">{err}</div>}
      {certs.length > 0 && (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {certs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.subject} — HSD {c.valid_to?.slice(0, 10)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
