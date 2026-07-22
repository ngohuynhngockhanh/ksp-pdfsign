import { useEffect, useState } from "react";
import { api, type Customer, type Rect } from "../api";
import { PdfCanvas } from "../components/PdfCanvas";
import { CertPicker } from "../components/CertPicker";
import { LogoSettings } from "../components/LogoSettings";
import { quickCreateCustomer } from "../util";

interface ZipFileEntry {
  doc_id: string;
  filename: string;
  size: number;
  signed?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

export function Signer({
  defaultIp,
  defaultLocation,
  preSign,
  onOpenDocument,
}: {
  defaultIp: string;
  defaultLocation: string;
  preSign?: {
    docId: string;
    filename: string;
    docType: string;
    customerId: number | null;
    orderId?: number | null;
  } | null;
  onOpenDocument?: (docPk: number) => void;
}) {
  const [docId, setDocId] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [rect, setRect] = useState<Rect | null>(null);
  const [zipFiles, setZipFiles] = useState<ZipFileEntry[]>([]);

  const [ip, setIp] = useState(defaultIp);
  const [pin, setPin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [certId, setCertId] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState(defaultLocation || "");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [documentId, setDocumentId] = useState<number | null>(null);

  useEffect(() => {
    api.listCustomers().then(setCustomers).catch(() => {});
  }, []);

  // Nạp BBBG vừa sinh (bỏ qua bước upload)
  useEffect(() => {
    if (preSign) {
      setDocId(preSign.docId);
      setFilename(preSign.filename);
      setRect(null);
      setDownloadUrl("");
      setDocumentId(null);
      setZipFiles([]);
      if (preSign.customerId != null) setCustomerId(String(preSign.customerId));
    }
  }, [preSign]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr("");
    setDownloadUrl("");
    setDocumentId(null);
    setRect(null);
    const isZip = f.name.toLowerCase().endsWith(".zip") || f.type.includes("zip");
    try {
      if (isZip) {
        const r = await api.uploadZip(f);
        setZipFiles(r.files.map((x) => ({ ...x, signed: false })));
        setDocId(null);
        setFilename("");
      } else {
        setZipFiles([]);
        const r = await api.upload(f);
        setDocId(r.doc_id);
        setFilename(r.filename);
      }
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  // Chon 1 file trong danh sach ZIP de xem/ky (khong dong tab, ky xong chon file ke)
  function pickZipFile(zf: ZipFileEntry) {
    setDocId(zf.doc_id);
    setFilename(zf.filename);
    setRect(null);
    setDownloadUrl("");
    setDocumentId(null);
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
        doc_type: preSign?.docType || "",
        order_id: preSign?.orderId ?? null,
      });
      setDownloadUrl(r.download_url);
      setDocumentId(r.document_id);
      if (zipFiles.length) {
        setZipFiles((prev) =>
          prev.map((z) => (z.doc_id === docId ? { ...z, signed: true } : z)),
        );
      }
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
        <input type="file" accept="application/pdf,.zip" onChange={onUpload} />
        {filename && zipFiles.length === 0 && <div className="muted">{filename}</div>}
        {zipFiles.length > 0 && (
          <div className="zip-list">
            <div className="muted">
              {zipFiles.length} file trong ZIP — chọn từng file để ký lần lượt:
            </div>
            {zipFiles.map((zf) => (
              <div
                key={zf.doc_id}
                className={
                  "zip-item" +
                  (docId === zf.doc_id ? " active" : "") +
                  (zf.signed ? " signed" : "")
                }
                onClick={() => pickZipFile(zf)}
              >
                <span className="zip-name">
                  {zf.signed ? "✅ " : ""}
                  {zf.filename}
                </span>
                <span className="muted">{formatSize(zf.size)}</span>
              </div>
            ))}
          </div>
        )}

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
            {documentId != null && onOpenDocument && (
              <button className="link-btn" onClick={() => onOpenDocument(documentId)}>
                📁 Mở trong Hồ sơ
              </button>
            )}
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
