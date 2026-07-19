import { useEffect, useState } from "react";
import { api } from "../api";

type Item = { ten: string; dvt: string; so_luong: string };
type Ngay = { day: number; month: number; year: number };

function soBB(n: Ngay): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(n.day)}-${p(n.month)}-${n.year}/BB-BGTB`;
}

export function CreateBBBG({
  onGenerated,
}: {
  onGenerated: (docId: string, filename: string, customerId: number | null) => void;
}) {
  const [suggested, setSuggested] = useState<{ id: number; name: string } | null>(null);
  const [templates, setTemplates] = useState<{ key: string; label: string }[]>([]);
  const [templateKey, setTemplateKey] = useState("bbbg_thiet_bi");
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [parsed, setParsed] = useState(false);

  const today = new Date();
  const [ngay, setNgay] = useState<Ngay>({
    day: today.getDate(),
    month: today.getMonth() + 1,
    year: today.getFullYear(),
  });
  const [soBb, setSoBb] = useState(soBB(ngay));
  const [noiLap, setNoiLap] = useState("Đắk Lắk");
  const [benB, setBenB] = useState({
    name: "",
    address: "",
    mst: "",
    dai_dien: "",
    chuc_vu: "",
    nguoi_nhan: "",
    dien_thoai: "",
  });
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    api.bbbgTemplates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);

  async function onInvoice(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setParsing(true);
    setErr("");
    try {
      const r = await api.parseInvoice(f);
      setBenB((b) => ({ ...b, name: r.buyer.name, address: r.buyer.address, mst: r.buyer.mst }));
      setItems(r.items.map((it) => ({ ten: it.ten, dvt: it.dvt, so_luong: it.so_luong })));
      if (r.ngay) {
        setNgay(r.ngay);
        setSoBb(soBB(r.ngay));
      }
      setSuggested(r.suggested_customer);
      setParsed(true);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function setItem(i: number, k: keyof Item, v: string) {
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  }

  async function generate() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.bbbgGenerate({
        so_bb: soBb,
        noi_lap: noiLap,
        ngay,
        ben_b: benB,
        items,
        template_key: templateKey,
        filename: `BBBG-${benB.name.slice(0, 20).trim() || "khach"}.pdf`,
      });
      onGenerated(r.doc_id, r.filename, suggested?.id ?? null);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-1col">
      <h3>Tạo Biên bản bàn giao từ hóa đơn</h3>

      <div className="panel">
        <label>
          1. Tải hóa đơn (PDF hoặc XML) để tự điền
          <input
            type="file"
            accept="application/pdf,.xml,text/xml,application/xml"
            onChange={onInvoice}
          />
        </label>
        <div className="muted">Nên dùng file XML — dữ liệu chính xác hơn PDF.</div>
        {parsing && <div className="muted">Đang đọc hóa đơn…</div>}
        {parsed && <div className="ok-note">✅ Đã đọc hóa đơn — kiểm tra & sửa bên dưới.</div>}
        {parsed &&
          (suggested ? (
            <div className="ok-note">
              👤 Khách hàng đề xuất: <b>{suggested.name}</b> — BBBG sẽ tự gán vào khách này khi ký.
            </div>
          ) : (
            <div className="muted">
              👤 Chưa có khách hàng khớp MST/tên — có thể tạo ở tab Khách hàng hoặc chọn lúc ký.
            </div>
          ))}
      </div>

      <div className="panel">
        <h3>2. Thông tin biên bản</h3>
        <div className="grid2">
          <label>
            Số BB
            <input value={soBb} onChange={(e) => setSoBb(e.target.value)} />
          </label>
          <label>
            Nơi lập
            <input value={noiLap} onChange={(e) => setNoiLap(e.target.value)} />
          </label>
          <label>
            Ngày
            <input
              type="number"
              value={ngay.day}
              onChange={(e) => setNgay({ ...ngay, day: +e.target.value })}
            />
          </label>
          <label>
            Tháng
            <input
              type="number"
              value={ngay.month}
              onChange={(e) => setNgay({ ...ngay, month: +e.target.value })}
            />
          </label>
          <label>
            Năm
            <input
              type="number"
              value={ngay.year}
              onChange={(e) => setNgay({ ...ngay, year: +e.target.value })}
            />
          </label>
          <label>
            Mẫu template
            <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="panel">
        <h3>3. Bên B (bên nhận)</h3>
        <label>
          Tên đơn vị
          <input value={benB.name} onChange={(e) => setBenB({ ...benB, name: e.target.value })} />
        </label>
        <label>
          Địa chỉ
          <input value={benB.address} onChange={(e) => setBenB({ ...benB, address: e.target.value })} />
        </label>
        <div className="grid2">
          <label>
            MST
            <input value={benB.mst} onChange={(e) => setBenB({ ...benB, mst: e.target.value })} />
          </label>
          <label>
            Đại diện
            <input value={benB.dai_dien} onChange={(e) => setBenB({ ...benB, dai_dien: e.target.value })} />
          </label>
          <label>
            Chức vụ
            <input value={benB.chuc_vu} onChange={(e) => setBenB({ ...benB, chuc_vu: e.target.value })} />
          </label>
          <label>
            Người nhận
            <input value={benB.nguoi_nhan} onChange={(e) => setBenB({ ...benB, nguoi_nhan: e.target.value })} />
          </label>
          <label>
            Điện thoại
            <input value={benB.dien_thoai} onChange={(e) => setBenB({ ...benB, dien_thoai: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="panel">
        <h3>4. Danh sách hàng hóa</h3>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Tên hàng hóa</th>
              <th style={{ width: "16%" }}>Đơn vị</th>
              <th style={{ width: "16%" }}>Số lượng</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>
                  <input value={it.ten} onChange={(e) => setItem(i, "ten", e.target.value)} />
                </td>
                <td>
                  <input value={it.dvt} onChange={(e) => setItem(i, "dvt", e.target.value)} />
                </td>
                <td>
                  <input value={it.so_luong} onChange={(e) => setItem(i, "so_luong", e.target.value)} />
                </td>
                <td>
                  <button className="danger-link" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setItems([...items, { ten: "", dvt: "", so_luong: "" }])}>
          + Thêm dòng
        </button>
      </div>

      {err && <div className="error">{err}</div>}
      <button className="primary" disabled={busy || !benB.name || items.length === 0} onClick={generate}>
        {busy ? "Đang sinh…" : "Sinh BBBG → Ký ngay"}
      </button>
    </div>
  );
}
