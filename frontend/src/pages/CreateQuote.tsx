import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DocRecord, type OrderRec } from "../api";

type QItem = { ten: string; dvt: string; so_luong: string; don_gia: string; thue_suat: string };
type Product = Awaited<ReturnType<typeof api.listProducts>>[number];
type Ngay = { day: number; month: number; year: number };
type Source = "tay" | "hoa_don" | "ho_so";

const VAT_RATES = ["0", "5", "8", "10"];

// "1.500.000" / "1,500,000" / "1500000" -> so
function parseNum(s: string | number): number {
  if (typeof s === "number") return s;
  let t = (s || "").trim().replace(/\s/g, "");
  if (!t) return 0;
  const dots = (t.match(/\./g) || []).length;
  if (dots > 1 || (dots === 1 && /\.\d{3}$/.test(t) && !t.includes(","))) {
    t = t.replace(/\./g, "");
  }
  t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

// Chuan hoa ten (bo dau, thuong) de doi chieu voi mat hang ton kho
function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function soDeXuat(n: Ngay, key: string): string {
  const p = (x: number) => String(x).padStart(2, "0");
  const suffix =
    key === "de_nghi_tt" ? "DNTT-INUT" : key === "bbnt" ? "BBNT-INUT" : "BG-INUT";
  return `${p(n.day)}-${p(n.month)}-${n.year}/${suffix}`;
}

export function CreateQuote({
  onGenerated,
}: {
  onGenerated: (
    docId: string,
    filename: string,
    docType: string,
    customerId: number | null,
    orderId: number | null,
  ) => void;
}) {
  const [templates, setTemplates] = useState<{ key: string; label: string }[]>([]);
  const [templateKey, setTemplateKey] = useState("bao_gia");
  const [source, setSource] = useState<Source>("tay");
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // Ton kho theo ten chuan hoa (tong cac kho) — chi de hien badge tham khao
  const [stockByName, setStockByName] = useState<Map<string, number>>(new Map());
  const [orders, setOrders] = useState<OrderRec[]>([]);
  const [orderId, setOrderId] = useState("");
  const [pickedDoc, setPickedDoc] = useState("");
  const [suggested, setSuggested] = useState<{ id: number; name: string } | null>(null);
  const [aiInfo, setAiInfo] = useState<{ enabled: boolean; model: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState("");

  const today = new Date();
  const [ngay, setNgay] = useState<Ngay>({
    day: today.getDate(),
    month: today.getMonth() + 1,
    year: today.getFullYear(),
  });
  const [so, setSo] = useState(soDeXuat(
    { day: today.getDate(), month: today.getMonth() + 1, year: today.getFullYear() },
    "bao_gia",
  ));
  const [noiLap, setNoiLap] = useState("");
  const [benB, setBenB] = useState({
    name: "",
    address: "",
    mst: "",
    email: "",
    dai_dien: "",
    ten_ngan: "",
  });
  const [items, setItems] = useState<QItem[]>([
    { ten: "", dvt: "", so_luong: "1", don_gia: "", thue_suat: "10" },
  ]);
  const [thuyetMinh, setThuyetMinh] = useState("");
  const [hieuLuc, setHieuLuc] = useState("30");
  // De nghi thanh toan
  const [loaiTt, setLoaiTt] = useState<"toan_bo" | "co_coc" | "nhieu_phan">("toan_bo");
  const [tienCoc, setTienCoc] = useState("");
  const [daThanhToan, setDaThanhToan] = useState("");
  const [soTienDotNay, setSoTienDotNay] = useState("");
  const [dotThu, setDotThu] = useState("2");
  const [tongSoDot, setTongSoDot] = useState("3");
  const [hanThanhToan, setHanThanhToan] = useState("05 ngày");
  const [canCu, setCanCu] = useState("");
  // Bien ban nghiem thu
  const [bbntGhiChu, setBbntGhiChu] = useState(
    "Bảo hành 1 năm 1 đổi 1 kể từ ngày nghiệm thu*",
  );
  const [bbntDieuKhoan, setBbntDieuKhoan] = useState("");

  const isDntt = templateKey === "de_nghi_tt";
  const isBbnt = templateKey === "bbnt";

  useEffect(() => {
    api.quoteTemplates().then((r) => setTemplates(r.templates)).catch(() => {});
    api.aiStatus().then(setAiInfo).catch(() => {});
    api.listProducts().then(setProducts).catch(() => {});
    api.listOrders().then(setOrders).catch(() => {});
    api
      .invStock()
      .then((r) => {
        const m = new Map<string, number>();
        for (const row of r.rows) {
          const k = normName(row.ten);
          m.set(k, (m.get(k) ?? 0) + row.ton);
        }
        setStockByName(m);
      })
      .catch(() => {});
  }, []);

  async function newOrder() {
    const goiy = `${benB.name || "Khách"} — ${ngay.day}/${ngay.month}/${ngay.year}`;
    const name = window.prompt("Tên đơn hàng mới:", goiy);
    if (!name?.trim()) return;
    try {
      const o = await api.createOrder({ name: name.trim(), customer_id: suggested?.id ?? null });
      setOrders((arr) => [o, ...arr]);
      setOrderId(String(o.id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    if (source === "ho_so" && docs.length === 0) {
      api
        .listDocuments({ perPage: 100 })
        .then((r) => setDocs(r.items))
        .catch(() => {});
    }
  }, [source, docs.length]);

  // Doi template: cap nhat so de xuat (neu nguoi dung chua sua khac dang de xuat)
  function switchTemplate(key: string) {
    setTemplateKey(key);
    setSo((s) => (/\/(BG|DNTT)-INUT$/.test(s) ? soDeXuat(ngay, key) : s));
  }

  const totals = useMemo(() => {
    let truocThue = 0;
    let thue = 0;
    for (const it of items) {
      const tt = Math.round(parseNum(it.so_luong) * parseNum(it.don_gia));
      truocThue += tt;
      thue += Math.round((tt * parseNum(it.thue_suat)) / 100);
    }
    return { truocThue, thue, tong: truocThue + thue };
  }, [items]);

  const conLai = useMemo(() => {
    if (!isDntt || loaiTt === "toan_bo") return totals.tong;
    if (loaiTt === "co_coc") return Math.max(0, totals.tong - parseNum(tienCoc));
    const dotNay = parseNum(soTienDotNay);
    return dotNay || Math.max(0, totals.tong - parseNum(tienCoc) - parseNum(daThanhToan));
  }, [isDntt, loaiTt, totals.tong, tienCoc, daThanhToan, soTienDotNay]);

  function applyParsed(r: {
    buyer: { name: string; mst: string; address: string; email?: string };
    items: {
      ten: string;
      dvt: string;
      so_luong: string;
      don_gia?: string;
      thue_suat?: string;
    }[];
    ngay: Ngay | null;
    suggested_customer: { id: number; name: string } | null;
  }) {
    setBenB((b) => ({
      ...b,
      name: r.buyer.name,
      address: r.buyer.address,
      mst: r.buyer.mst,
      email: r.buyer.email || "",
    }));
    setItems(
      r.items.map((it) => ({
        ten: it.ten,
        dvt: it.dvt,
        so_luong: String(parseNum(it.so_luong || "1") || 1),
        don_gia: String(parseNum(it.don_gia || "0") || ""),
        // XML co TSuat tung dong ("10", "8", "KCT"->0); PDF khong co -> 10
        thue_suat:
          it.thue_suat !== undefined && it.thue_suat !== ""
            ? String(parseNum(it.thue_suat))
            : "10",
      })),
    );
    if (r.ngay) {
      setNgay(r.ngay);
      setSo(soDeXuat(r.ngay, templateKey));
    }
    setSuggested(r.suggested_customer);
    setParsed(true);
    // Hoa don vua parse da duoc backend ghi nho vao danh muc -> lam moi
    api.listProducts().then(setProducts).catch(() => {});
  }

  async function onInvoiceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setParsing(true);
    setErr("");
    try {
      applyParsed(await api.parseInvoice(f));
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function onParseStored() {
    if (!pickedDoc) return;
    setParsing(true);
    setErr("");
    try {
      applyParsed(await api.parseInvoiceDoc(Number(pickedDoc)));
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function setItem(i: number, k: keyof QItem, v: string) {
    setItems((arr) =>
      arr.map((it, j) => {
        if (j !== i) return it;
        // Go ten khop danh muc (chon tu autocomplete) -> autofill DVT/don gia/thue
        if (k === "ten") {
          const p = products.find((x) => x.ten.toLowerCase() === v.trim().toLowerCase());
          if (p) {
            return {
              ...it,
              ten: v,
              dvt: p.dvt || it.dvt,
              don_gia: p.don_gia ? String(p.don_gia) : it.don_gia,
              thue_suat: String(p.thue_suat ?? it.thue_suat),
            };
          }
        }
        return { ...it, [k]: v };
      }),
    );
  }

  function addFromCatalog(id: string) {
    const p = products.find((x) => x.id === Number(id));
    if (!p) return;
    setItems((arr) => {
      // Neu dong cuoi con trong thi dien vao do, nguoc lai them dong moi
      const row: QItem = {
        ten: p.ten,
        dvt: p.dvt,
        so_luong: "1",
        don_gia: p.don_gia ? String(p.don_gia) : "",
        thue_suat: String(p.thue_suat ?? 10),
      };
      const last = arr[arr.length - 1];
      if (last && !last.ten.trim() && !parseNum(last.don_gia)) {
        return [...arr.slice(0, -1), row];
      }
      return [...arr, row];
    });
  }

  function itemsPayload() {
    return items
      .filter((it) => it.ten.trim())
      .map((it) => ({
        ten: it.ten,
        dvt: it.dvt,
        so_luong: parseNum(it.so_luong),
        don_gia: parseNum(it.don_gia),
        thue_suat: parseNum(it.thue_suat),
      }));
  }

  async function genNarrative() {
    setAiBusy(true);
    setErr("");
    try {
      const r = await api.aiQuoteNarrative({
        items: itemsPayload(),
        khach: benB.name,
        tong: isDntt ? conLai : totals.tong,
        note: aiNote,
        loai: templateKey,
      });
      setThuyetMinh(r.text);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  function buildPayload() {
    const prefix = isDntt ? "DNTT" : isBbnt ? "BBNT" : "Bao-gia";
    return {
      bbnt_ghi_chu: bbntGhiChu,
      bbnt_dieu_khoan: bbntDieuKhoan,
      template_key: templateKey,
      so,
      ngay,
      noi_lap: noiLap,
      ben_b: benB,
      items: itemsPayload(),
      thuyet_minh: thuyetMinh,
      hieu_luc: parseNum(hieuLuc) || 30,
      filename: `${prefix}-${benB.name.slice(0, 20).trim() || "khach"}.pdf`,
      loai_tt: loaiTt,
      tien_coc: parseNum(tienCoc),
      da_thanh_toan: parseNum(daThanhToan),
      so_tien_dot_nay: parseNum(soTienDotNay),
      dot_thu: parseNum(dotThu),
      tong_so_dot: parseNum(tongSoDot),
      han_thanh_toan: hanThanhToan,
      can_cu: canCu,
    };
  }

  // WYSIWYG: render lai PDF xem truoc (debounce) moi khi form thay doi
  const previewDeps = JSON.stringify([
    templateKey, so, ngay, noiLap, benB, items, thuyetMinh, hieuLuc,
    loaiTt, tienCoc, daThanhToan, soTienDotNay, dotThu, tongSoDot,
    hanThanhToan, canCu, bbntGhiChu, bbntDieuKhoan,
  ]);
  useEffect(() => {
    const t = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const blob = await api.quotePreview(buildPayload());
        setPreviewErr("");
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      } catch (ex) {
        setPreviewErr((ex as Error).message);
      } finally {
        setPreviewBusy(false);
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDeps]);

  const previewUrlRef = useRef("");
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  async function generate() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.quoteGenerate(buildPayload());
      onGenerated(
        r.doc_id,
        r.filename,
        r.doc_type,
        r.customer_id ?? suggested?.id ?? null,
        orderId ? Number(orderId) : null,
      );
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-1col quote-page">
      <h3>Tạo Báo giá / Đề nghị thanh toán</h3>

      <div className="quote-2col">
      <div className="q-form">
      <div className="panel">
        <label>
          Loại chứng từ
          <select value={templateKey} onChange={(e) => switchTemplate(e.target.value)}>
            {(templates.length
              ? templates
              : [
                  { key: "bao_gia", label: "Báo giá" },
                  { key: "de_nghi_tt", label: "Đề nghị thanh toán" },
                  { key: "bbnt", label: "Biên bản nghiệm thu" },
                ]
            ).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid2" style={{ marginTop: 8 }}>
          <label>
            📦 Đơn hàng (gom Báo giá → BBBG → BBNT → Đề nghị TT)
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">— không gắn đơn hàng —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.name} ({o.document_count} hồ sơ)
                </option>
              ))}
            </select>
          </label>
          <div style={{ alignSelf: "end" }}>
            <button onClick={newOrder}>➕ Tạo đơn hàng mới</button>
          </div>
        </div>

        <div className="grid2" style={{ marginTop: 8 }}>
          <label>
            Nguồn hàng hóa
            <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
              <option value="tay">Nhập tay</option>
              <option value="hoa_don">Từ hóa đơn (PDF/XML)</option>
              <option value="ho_so">Từ hồ sơ có sẵn</option>
            </select>
          </label>
          {source === "hoa_don" && (
            <label>
              Tải hóa đơn để tự điền
              <input
                type="file"
                accept="application/pdf,.xml,text/xml,application/xml"
                onChange={onInvoiceFile}
              />
            </label>
          )}
          {source === "ho_so" && (
            <label>
              Chọn hồ sơ (hóa đơn đã lưu)
              <select value={pickedDoc} onChange={(e) => setPickedDoc(e.target.value)}>
                <option value="">— chọn hồ sơ —</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                    {d.customer_name ? ` · ${d.customer_name}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {source === "ho_so" && (
          <button disabled={!pickedDoc || parsing} onClick={onParseStored}>
            Đọc hàng hóa từ hồ sơ
          </button>
        )}
        {parsing && <div className="muted">Đang đọc hóa đơn…</div>}
        {parsed && <div className="ok-note">✅ Đã đọc dữ liệu — kiểm tra & sửa bên dưới.</div>}
        {parsed && suggested && (
          <div className="ok-note">
            👤 Khách hàng đề xuất: <b>{suggested.name}</b> — sẽ tự gán khi ký.
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Thông tin chung</h3>
        <div className="grid2">
          <label>
            Số
            <input value={so} onChange={(e) => setSo(e.target.value)} />
          </label>
          <label>
            Nơi lập
            <input
              placeholder={isDntt ? "TP.HCM (mặc định)" : "Đắk Lắk (mặc định)"}
              value={noiLap}
              onChange={(e) => setNoiLap(e.target.value)}
            />
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
          {!isDntt && !isBbnt && (
            <label>
              Hiệu lực báo giá (ngày)
              <input value={hieuLuc} onChange={(e) => setHieuLuc(e.target.value)} />
            </label>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Khách hàng (Kính gửi)</h3>
        <label>
          Tên đơn vị
          <input value={benB.name} onChange={(e) => setBenB({ ...benB, name: e.target.value })} />
        </label>
        <label>
          Địa chỉ
          <input
            value={benB.address}
            onChange={(e) => setBenB({ ...benB, address: e.target.value })}
          />
        </label>
        <div className="grid2">
          <label>
            MST
            <input value={benB.mst} onChange={(e) => setBenB({ ...benB, mst: e.target.value })} />
          </label>
          <label>
            Email
            <input
              value={benB.email}
              onChange={(e) => setBenB({ ...benB, email: e.target.value })}
            />
          </label>
          {isBbnt && (
            <>
              <label>
                Đại diện (bên mua)
                <input
                  placeholder="vd: Ông Lê Xuân Tú"
                  value={benB.dai_dien}
                  onChange={(e) => setBenB({ ...benB, dai_dien: e.target.value })}
                />
              </label>
              <label>
                Tên gọi tắt (in trong BBNT)
                <input
                  placeholder="vd: PHE VIET NAM"
                  value={benB.ten_ngan}
                  onChange={(e) => setBenB({ ...benB, ten_ngan: e.target.value })}
                />
              </label>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Danh sách hàng hóa / hạng mục</h3>
        <label>
          📦 Thêm nhanh từ danh mục đã dùng ({products.length} món)
          <select
            value=""
            disabled={products.length === 0}
            onChange={(e) => addFromCatalog(e.target.value)}
          >
            <option value="">
              {products.length
                ? "— chọn món để thêm vào bảng —"
                : "— chưa có món nào: danh mục tự lưu sau mỗi lần sinh báo giá —"}
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.ten}
                {p.don_gia ? ` · ${vnd(p.don_gia)} đ` : ""}
                {p.dvt ? ` / ${p.dvt}` : ""} · VAT {p.thue_suat}%
              </option>
            ))}
          </select>
        </label>
        <datalist id="pl-products">
          {products.map((p) => (
            <option key={p.id} value={p.ten} />
          ))}
        </datalist>
        <div style={{ overflowX: "auto" }}>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Tên hàng hóa / dịch vụ</th>
                <th style={{ width: "9%" }}>ĐVT</th>
                <th style={{ width: "8%" }}>SL</th>
                <th style={{ width: "14%" }}>Đơn giá</th>
                <th style={{ width: "13%" }}>Thành tiền</th>
                <th style={{ width: "9%" }}>Thuế (%)</th>
                <th style={{ width: "12%" }}>Tiền thuế</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const tt = Math.round(parseNum(it.so_luong) * parseNum(it.don_gia));
                const thue = Math.round((tt * parseNum(it.thue_suat)) / 100);
                return (
                  <tr key={i}>
                    <td>
                      <input
                        value={it.ten}
                        list="pl-products"
                        placeholder="gõ để gợi ý từ danh mục…"
                        onChange={(e) => setItem(i, "ten", e.target.value)}
                      />
                      {(() => {
                        const ton = stockByName.get(normName(it.ten));
                        if (ton === undefined || !it.ten.trim()) return null;
                        const du = ton >= parseNum(it.so_luong);
                        return (
                          <span
                            className={`chip sm ${du ? "green" : "red"}`}
                            title="Tồn kho hiện tại (tham khảo — báo giá không trừ kho)"
                          >
                            Tồn: {ton}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      <input value={it.dvt} onChange={(e) => setItem(i, "dvt", e.target.value)} />
                    </td>
                    <td>
                      <input
                        value={it.so_luong}
                        onChange={(e) => setItem(i, "so_luong", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={it.don_gia}
                        onChange={(e) => setItem(i, "don_gia", e.target.value)}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>{vnd(tt)}</td>
                    <td>
                      <select
                        value={it.thue_suat}
                        onChange={(e) => setItem(i, "thue_suat", e.target.value)}
                      >
                        {!VAT_RATES.includes(it.thue_suat) && (
                          <option value={it.thue_suat}>{it.thue_suat}%</option>
                        )}
                        {VAT_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "right" }}>{vnd(thue)}</td>
                    <td>
                      <button
                        className="danger-link"
                        onClick={() => setItems(items.filter((_, j) => j !== i))}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          onClick={() =>
            setItems([...items, { ten: "", dvt: "", so_luong: "1", don_gia: "", thue_suat: "10" }])
          }
        >
          + Thêm dòng
        </button>

        {isBbnt ? (
          <div className="muted" style={{ marginTop: 8 }}>
            ℹ️ BBNT không in giá — chỉ dùng tên hạng mục, ĐVT và số lượng.
          </div>
        ) : (
          <div className="totals-box">
            <div>
              Cộng tiền hàng: <b>{vnd(totals.truocThue)} đ</b>
            </div>
            <div>
              Thuế GTGT: <b>{vnd(totals.thue)} đ</b>
            </div>
            <div className="grand">
              TỔNG THANH TOÁN: <b>{vnd(totals.tong)} đ</b>
            </div>
          </div>
        )}
      </div>

      {isBbnt && (
        <div className="panel">
          <h3>Biên bản nghiệm thu</h3>
          <label>
            Ghi chú in trên từng hạng mục
            <input value={bbntGhiChu} onChange={(e) => setBbntGhiChu(e.target.value)} />
          </label>
          <label>
            Điều kiện bảo hành / điều khoản
            <textarea
              rows={5}
              placeholder="Để trống = dùng điều kiện bảo hành mặc định của INUT (1 năm 1 đổi 1, loại trừ hư hỏng do vận hành sai, hỏa hoạn, tự ý sửa chữa…)"
              value={bbntDieuKhoan}
              onChange={(e) => setBbntDieuKhoan(e.target.value)}
            />
          </label>
        </div>
      )}

      {isDntt && (
        <div className="panel">
          <h3>Đề nghị thanh toán</h3>
          <div className="grid2">
            <label>
              Loại thanh toán
              <select
                value={loaiTt}
                onChange={(e) => setLoaiTt(e.target.value as typeof loaiTt)}
              >
                <option value="toan_bo">Thanh toán toàn bộ</option>
                <option value="co_coc">Đã đặt cọc — thanh toán phần còn lại</option>
                <option value="nhieu_phan">Thanh toán nhiều đợt</option>
              </select>
            </label>
            <label>
              Căn cứ (tùy chọn)
              <input
                placeholder="vd: theo hợp đồng số 01/2026/HĐKT"
                value={canCu}
                onChange={(e) => setCanCu(e.target.value)}
              />
            </label>
            {(loaiTt === "co_coc" || loaiTt === "nhieu_phan") && (
              <label>
                Số tiền đã đặt cọc
                <input value={tienCoc} onChange={(e) => setTienCoc(e.target.value)} />
              </label>
            )}
            {loaiTt === "nhieu_phan" && (
              <>
                <label>
                  Đã thanh toán các đợt trước
                  <input value={daThanhToan} onChange={(e) => setDaThanhToan(e.target.value)} />
                </label>
                <label>
                  Số tiền đợt này (trống = tự tính phần còn lại)
                  <input value={soTienDotNay} onChange={(e) => setSoTienDotNay(e.target.value)} />
                </label>
                <label>
                  Đợt thứ
                  <input value={dotThu} onChange={(e) => setDotThu(e.target.value)} />
                </label>
                <label>
                  Tổng số đợt
                  <input value={tongSoDot} onChange={(e) => setTongSoDot(e.target.value)} />
                </label>
              </>
            )}
            <label>
              Hạn thanh toán
              <input value={hanThanhToan} onChange={(e) => setHanThanhToan(e.target.value)} />
            </label>
          </div>
          <div className="totals-box">
            <div className="grand">
              {loaiTt === "nhieu_phan" ? "SỐ TIỀN ĐỢT NÀY" : "CÒN LẠI CẦN THANH TOÁN"}:{" "}
              <b>{vnd(conLai)} đ</b>
            </div>
          </div>
        </div>
      )}

      {!isBbnt && (
      <div className="panel">
        <h3>Thuyết minh (tùy chọn)</h3>
        <div className="grid2">
          <label>
            Gợi ý thêm cho AI (tùy chọn)
            <input
              placeholder="vd: nhấn mạnh bảo hành 24 tháng, triển khai trong 2 tuần"
              value={aiNote}
              onChange={(e) => setAiNote(e.target.value)}
            />
          </label>
          <div style={{ alignSelf: "end" }}>
            <button
              disabled={aiBusy || !aiInfo?.enabled || itemsPayload().length === 0}
              onClick={genNarrative}
              title={aiInfo?.enabled ? `Model: ${aiInfo.model}` : "Chưa cấu hình AI trong .env"}
            >
              {aiBusy ? "AI đang viết…" : "🤖 Sinh thuyết minh (AI)"}
            </button>
            {aiInfo && !aiInfo.enabled && (
              <span className="muted"> Chưa cấu hình AI (đặt AI_ENABLED=true trong .env)</span>
            )}
          </div>
        </div>
        <textarea
          rows={6}
          placeholder="Đoạn giới thiệu/thuyết minh in trên chứng từ — có thể tự viết hoặc bấm nút AI rồi sửa lại."
          value={thuyetMinh}
          onChange={(e) => setThuyetMinh(e.target.value)}
        />
      </div>
      )}

      {err && <div className="error">{err}</div>}
      <button
        className="primary"
        disabled={busy || !benB.name || itemsPayload().length === 0}
        onClick={generate}
      >
        {busy
          ? "Đang sinh…"
          : isDntt
            ? "Sinh Đề nghị thanh toán → Ký ngay"
            : isBbnt
              ? "Sinh Biên bản nghiệm thu → Ký ngay"
              : "Sinh Báo giá → Ký ngay"}
      </button>
      </div>

      <div className="q-preview">
        <div className="pv-head">
          <b>👁️ Xem trước</b>
          <span className="muted">
            {previewBusy ? "Đang cập nhật…" : "tự cập nhật khi sửa"}
          </span>
        </div>
        {previewErr && <div className="error">{previewErr}</div>}
        {previewUrl ? (
          <iframe src={previewUrl + "#toolbar=0&navpanes=0"} title="Xem trước PDF" />
        ) : (
          <div className="pv-empty">Đang tạo bản xem trước…</div>
        )}
      </div>
      </div>
    </div>
  );
}
