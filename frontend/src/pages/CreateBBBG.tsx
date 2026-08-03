import { useEffect, useState } from "react";
import { api } from "../api";
import { SmartPartyPaste } from "../components/SmartPartyPaste";

type Item = { ten: string; dvt: string; so_luong: string };
type Ngay = { day: number; month: number; year: number };

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

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
    email: "",
    dai_dien: "",
    chuc_vu: "",
    nguoi_nhan: "",
    dien_thoai: "",
  });
  const [items, setItems] = useState<Item[]>([]);
  const [stockByName, setStockByName] = useState<Map<string, { qty: number; dvt: string }>>(new Map());

  useEffect(() => {
    api.bbbgTemplates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);

  useEffect(() => {
    const date = `${ngay.year}-${String(ngay.month).padStart(2, "0")}-${String(ngay.day).padStart(2, "0")}`;
    api.invAvailability(date).then((r) => {
      const map = new Map<string, { qty: number; dvt: string }>();
      for (const row of r.rows) {
        const key = normName(row.ten);
        const current = map.get(key);
        map.set(key, { qty: (current?.qty ?? 0) + (row.kha_dung ?? row.ton), dvt: current?.dvt || row.dvt });
      }
      setStockByName(map);
    }).catch(() => {});
  }, [ngay.day, ngay.month, ngay.year]);

  async function onInvoice(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setParsing(true);
    setErr("");
    try {
      const r = await api.parseInvoice(f);
      setBenB((b) => ({
        ...b,
        name: r.buyer.name,
        address: r.buyer.address,
        mst: r.buyer.mst,
        email: (r.buyer as { email?: string }).email || "",
      }));
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
      onGenerated(r.doc_id, r.filename, r.customer_id ?? suggested?.id ?? null);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const missingUnits = items.filter((item) => item.ten.trim() && !item.dvt.trim()).length;
  const ready = parsed && Boolean(benB.name.trim()) && items.length > 0 && missingUnits === 0;

  return (
    <div className="page-1col bbbg-studio">
      <section className="bbbg-hero">
        <div className="bbbg-hero-copy">
          <span>AI DOCUMENT STUDIO · BÀN GIAO</span>
          <h1>Biên bản bàn giao, từ hóa đơn đến bản ký.</h1>
          <p>Đưa file nguồn vào một lần. CRM đọc bên nhận, hàng hóa và ngày chứng từ; bạn chỉ cần duyệt lại trước khi sinh PDF.</p>
          <div className="bbbg-flow" aria-label="Quy trình tạo biên bản">
            <b><i>01</i>AI đọc hóa đơn</b><b><i>02</i>Kiểm tra dữ liệu</b><b><i>03</i>Sinh PDF & ký</b>
          </div>
        </div>
        <label className={`bbbg-dropzone ${parsed ? "parsed" : ""}`}>
          <input aria-label="Hóa đơn nguồn" type="file" accept="application/pdf,.xml,text/xml,application/xml" onChange={onInvoice} />
          <span>{parsing ? "ĐANG ĐỌC DỮ LIỆU" : parsed ? "ĐÃ NHẬN HÓA ĐƠN" : "HÓA ĐƠN NGUỒN"}</span>
          <strong>{parsing ? "AI đang bóc tách…" : parsed ? "Đổi file khác" : "Thả hoặc chọn PDF / XML"}</strong>
          <small>Ưu tiên XML để có dữ liệu chính xác nhất</small>
        </label>
      </section>

      {parsed && <div className="bbbg-ai-result">
        <span>AI đã điền dữ liệu nguồn</span>
        <b>{suggested ? `Khớp khách hàng: ${suggested.name}` : "Chưa khớp khách hàng trong CRM"}</b>
        <small>Hãy duyệt thông tin bên nhận và tồn kho trước khi tạo bản ký.</small>
      </div>}
      {err && <div className="error">{err}</div>}

      <div className="bbbg-workspace">
        <div className="bbbg-editor">
          <section className="bbbg-card">
            <header><span>01 · THÔNG TIN BIÊN BẢN</span><h2>Dấu mốc của hồ sơ</h2></header>
            <div className="bbbg-form-grid">
              <label>Số BB<input value={soBb} onChange={(e) => setSoBb(e.target.value)} /></label>
              <label>Nơi lập<input value={noiLap} onChange={(e) => setNoiLap(e.target.value)} /></label>
              <label>Ngày<input type="number" value={ngay.day} onChange={(e) => setNgay({ ...ngay, day: +e.target.value })} /></label>
              <label>Tháng<input type="number" value={ngay.month} onChange={(e) => setNgay({ ...ngay, month: +e.target.value })} /></label>
              <label>Năm<input type="number" value={ngay.year} onChange={(e) => setNgay({ ...ngay, year: +e.target.value })} /></label>
              <label>Mẫu template<select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>{templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
            </div>
          </section>

          <section className="bbbg-card">
            <header><span>02 · BÊN NHẬN</span><h2>Ai nhận bàn giao?</h2><p>Dán chữ ký email/Zalo hoặc chỉnh trực tiếp dữ liệu AI đã đọc.</p></header>
            <SmartPartyPaste onApply={(data) => setBenB((current) => ({
              ...current,
              ...Object.fromEntries(Object.entries(data).filter(([, value]) => value)),
            }))} />
            <div className="bbbg-party-grid">
              <label className="wide">Tên đơn vị<input value={benB.name} onChange={(e) => setBenB({ ...benB, name: e.target.value })} /></label>
              <label className="wide">Địa chỉ<input value={benB.address} onChange={(e) => setBenB({ ...benB, address: e.target.value })} /></label>
              <label>Mã số thuế<input value={benB.mst} onChange={(e) => setBenB({ ...benB, mst: e.target.value })} /></label>
              <label>Đại diện<input value={benB.dai_dien} onChange={(e) => setBenB({ ...benB, dai_dien: e.target.value })} /></label>
              <label>Chức vụ<input value={benB.chuc_vu} onChange={(e) => setBenB({ ...benB, chuc_vu: e.target.value })} /></label>
              <label>Người nhận<input value={benB.nguoi_nhan} onChange={(e) => setBenB({ ...benB, nguoi_nhan: e.target.value })} /></label>
              <label>Điện thoại<input value={benB.dien_thoai} onChange={(e) => setBenB({ ...benB, dien_thoai: e.target.value })} /></label>
              <label>Email<input value={benB.email} onChange={(e) => setBenB({ ...benB, email: e.target.value })} /></label>
            </div>
          </section>

          <section className="bbbg-card bbbg-items-card">
            <header><span>03 · HÀNG HÓA</span><h2>Danh mục bàn giao</h2><p>Đối chiếu số lượng với tồn kho tại ngày lập biên bản.</p></header>
            {missingUnits > 0 && <div className="stock-form-alert">Có {missingUnits} dòng thiếu đơn vị tính.</div>}
            <div className="bbbg-items-scroll"><table className="doc-table"><thead><tr><th>Tên hàng hóa</th><th>Đơn vị</th><th>Số lượng</th><th></th></tr></thead><tbody>
              {items.map((it, i) => <tr key={i}><td><input value={it.ten} onChange={(e) => setItem(i, "ten", e.target.value)} />{stockByName.get(normName(it.ten)) && <span className={`chip sm ${(stockByName.get(normName(it.ten))?.qty ?? 0) >= Number(it.so_luong || 0) ? "green" : "red"}`}>Tồn {ngay.day}/{ngay.month}: {stockByName.get(normName(it.ten))?.qty} {stockByName.get(normName(it.ten))?.dvt || "(thiếu ĐVT)"}</span>}</td><td><input className={it.ten.trim() && !it.dvt.trim() ? "field-missing" : ""} value={it.dvt} placeholder={it.ten.trim() ? "Thiếu ĐVT" : ""} onChange={(e) => setItem(i, "dvt", e.target.value)} /></td><td><input value={it.so_luong} onChange={(e) => setItem(i, "so_luong", e.target.value)} /></td><td><button className="danger-link" onClick={() => setItems(items.filter((_, j) => j !== i))}>Xóa</button></td></tr>)}
            </tbody></table></div>
            <button className="bbbg-add-row" onClick={() => setItems([...items, { ten: "", dvt: "", so_luong: "" }])}>+ Thêm hàng hóa</button>
          </section>
        </div>

        <aside className="bbbg-summary">
          <span>TRẠNG THÁI HỒ SƠ</span>
          <h2>{ready ? "Sẵn sàng tạo biên bản" : "Cần hoàn thiện dữ liệu"}</h2>
          <div><small>Bên nhận</small><b>{benB.name || "Chưa có"}</b></div>
          <div><small>Hàng hóa</small><b>{items.length} dòng</b></div>
          <div><small>Đơn vị tính</small><b>{missingUnits ? `Thiếu ${missingUnits} dòng` : "Đầy đủ"}</b></div>
          <div><small>Mẫu</small><b>{templates.find((item) => item.key === templateKey)?.label || templateKey}</b></div>
          <button className="primary" disabled={busy || !benB.name || items.length === 0} onClick={generate}>{busy ? "Đang sinh PDF…" : "Sinh BBBG → Ký ngay"}</button>
          <p>PDF được tạo ở bước kế tiếp; dữ liệu hiện tại vẫn có thể kiểm tra trước khi ký.</p>
        </aside>
      </div>
    </div>
  );
}
