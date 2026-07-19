import { useEffect, useState } from "react";
import { api, type Customer, type Rect } from "../api";
import { PdfCanvas } from "../components/PdfCanvas";
import { CertPicker } from "../components/CertPicker";
import { LogoSettings } from "../components/LogoSettings";
import { quickCreateCustomer } from "../util";

export function Signer({ defaultIp }: { defaultIp: string }) {
  const [docId, setDocId] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [rect, setRect] = useState<Rect | null>(null);

  const [ip, setIp] = useState(defaultIp);
  const [pin, setPin] = useState("");
  const [adminPassword, setAdminPassword] = useState("NhapHang123");
  const [certId, setCertId] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  useEffect(() => {
    api.listCustomers().then(setCustomers).catch(() => {});
  }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr("");
    setDownloadUrl("");
    setRect(null);
    try {
      const r = await api.upload(f);
      setDocId(r.doc_id);
      setFilename(r.filename);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  async function doSign() {
    if (!docId || !rect || !certId) return;
    setBusy(true);
    setErr("");
    setDownloadUrl("");
    try {
      const r = await api.sign({
        doc_id: docId,
        rect,
        cert_id: certId,
        agent: { ip, admin_password: adminPassword, pin },
        reason,
        location,
        signer_name: "",
        filename,
        customer_id: customerId === "" ? null : Number(customerId),
      });
      setDownloadUrl(r.download_url);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signer">
      <aside className="panel">
        <h3>1. Tải PDF</h3>
        <input type="file" accept="application/pdf" onChange={onUpload} />
        {filename && <div className="muted">{filename}</div>}

        <h3>2. Vùng chữ ký</h3>
        {rect ? (
          <div className="muted">
            Trang {rect.page + 1} — ({Math.round(rect.x1)}, {Math.round(rect.y1)}) →
            ({Math.round(rect.x2)}, {Math.round(rect.y2)}) pt
          </div>
        ) : (
          <div className="muted">Kéo chuột trên trang để chọn</div>
        )}

        <h3>3. Máy token (WIN-CA)</h3>
        <label>
          IP máy Windows
          <input value={ip} onChange={(e) => setIp(e.target.value)} />
        </label>
        <label>
          Mã PIN token
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
        </label>
        <label>
          Mật khẩu Administrator
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
        </label>

        <h3>4. Chứng thư số</h3>
        <CertPicker ip={ip} adminPassword={adminPassword} value={certId} onChange={setCertId} />

        <h3>Logo chữ ký (chìm)</h3>
        <LogoSettings />

        <h3>5. Thông tin ký (tuỳ chọn)</h3>
        <label>
          Lý do
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label>
          Nơi ký
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>

        <h3>6. Phân loại khách hàng (tuỳ chọn)</h3>
        <select
          value={customerId}
          onChange={async (e) => {
            if (e.target.value === "__new__") {
              const created = await quickCreateCustomer();
              if (created) {
                setCustomers(await api.listCustomers());
                setCustomerId(String(created.id));
              }
              return;
            }
            setCustomerId(e.target.value);
          }}
        >
          <option value="">— để trống, phân loại sau ở tab Hồ sơ —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new__">+ Tạo khách hàng mới…</option>
        </select>

        {err && <div className="error">{err}</div>}
        <button
          className="primary"
          disabled={!docId || !rect || !certId || busy}
          onClick={doSign}
        >
          {busy ? "Đang ký…" : "Ký số"}
        </button>
        {downloadUrl && (
          <>
            <div className="ok-note">✅ Đã ký và lưu vào hồ sơ.</div>
            <a className="download" href={downloadUrl}>
              ⬇️ Tải PDF đã ký
            </a>
          </>
        )}
      </aside>

      <section className="viewer">
        {docId ? (
          <PdfCanvas url={api.docUrl(docId)} onSelect={setRect} />
        ) : (
          <div className="center muted">Chưa có tài liệu. Hãy tải PDF lên.</div>
        )}
      </section>
    </div>
  );
}
