import { useState } from "react";
import { api, type SignatureReport } from "../api";

export function Verify() {
  const [reports, setReports] = useState<SignatureReport[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setErr("");
    setReports(null);
    try {
      const r = await api.verify(f);
      setReports(r.signatures);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="verify">
      <div className="panel">
        <h3>Kiểm tra chữ ký số của PDF</h3>
        <input type="file" accept="application/pdf" onChange={onFile} />
        {busy && <div className="muted">Đang kiểm tra…</div>}
        {err && <div className="error">{err}</div>}
      </div>

      {reports && reports.length === 0 && (
        <div className="card">Tài liệu không có chữ ký số nào.</div>
      )}

      {reports?.map((s, i) => (
        <div className="card sig-report" key={i}>
          <div className="sig-head">
            <span className={"badge " + summaryClass(s)}>{s.summary}</span>
            <b>{s.field_name}</b>
            <span className="muted">{s.signer_name}</span>
          </div>
          <table>
            <tbody>
              <Row label="Toàn vẹn (không sửa sau ký)" ok={s.intact} />
              <Row label="Hợp lệ mật mã" ok={s.valid} />
              <Row label="Chuỗi CA tin cậy" ok={s.trusted} />
              {s.revocation_ok !== null && (
                <Row label="Không bị thu hồi" ok={s.revocation_ok} />
              )}
              <tr>
                <td>Timestamp</td>
                <td>{s.has_timestamp ? "Có" : "Không"}</td>
              </tr>
              {s.signing_time && (
                <tr>
                  <td>Thời gian ký</td>
                  <td>{new Date(s.signing_time).toLocaleString("vi-VN")}</td>
                </tr>
              )}
              <tr>
                <td>Phạm vi ký</td>
                <td>{s.coverage}</td>
              </tr>
              {s.ltv && (
                <tr>
                  <td>LTV</td>
                  <td>{s.ltv}</td>
                </tr>
              )}
            </tbody>
          </table>
          {s.problems.length > 0 && (
            <ul className="problems">
              {s.problems.map((p, j) => (
                <li key={j}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <tr>
      <td>{label}</td>
      <td className={ok ? "ok" : "bad"}>{ok ? "✔ Đạt" : "✘ Không đạt"}</td>
    </tr>
  );
}

function summaryClass(s: SignatureReport) {
  if (s.intact && s.valid && s.trusted) return "green";
  if (s.intact && s.valid) return "amber";
  return "red";
}
