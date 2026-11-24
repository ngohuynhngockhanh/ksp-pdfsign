import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DocRecord, type OrderRec, type WebAdsDraftQuote } from "../api";
import { SmartPartyPaste } from "../components/SmartPartyPaste";
import { BilliardQuoteTab } from "../components/BilliardQuoteTab";
import {
  AppButton,
  DataView,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  PageHeader,
  PageShell,
  PromptDialog,
  ResponsiveTabs,
  SectionCard,
  SkeletonBlock,
  SplitWorkspace,
  StatusBadge,
  useToast,
} from "../components/ui";

type QItem = { ten: string; dvt: string; so_luong: string; don_gia: string; thue_suat: string };
type Product = Awaited<ReturnType<typeof api.listProducts>>[number];
type Ngay = { day: number; month: number; year: number };
type Source = "tay" | "hoa_don" | "ho_so";

const VAT_RATES = ["0", "5", "8", "10"];

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
  leadDraft,
  fromLeadId,
  onLeadDraftConsumed,
}: {
  onGenerated: (
    docId: string,
    filename: string,
    docType: string,
    customerId: number | null,
    orderId: number | null,
  ) => void;
  leadDraft?: WebAdsDraftQuote | null;
  fromLeadId?: number | null;
  onLeadDraftConsumed?: () => void;
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<{ key: string; label: string }[]>([]);
  const [templateKey, setTemplateKey] = useState("bao_gia");
  const [source, setSource] = useState<Source>("tay");
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stockByName, setStockByName] = useState<Map<string, { qty: number; dvt: string }>>(new Map());
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

  const [activeQuoteMode, setActiveQuoteMode] = useState<"standard" | "billiard">(
    leadDraft || fromLeadId ? "standard" : "billiard",
  );
  const [linkedLeadId, setLinkedLeadId] = useState<number | null>(null);
  const [leadBanner, setLeadBanner] = useState<{
    leadId: number;
    customerName: string;
    contact: string;
  } | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const appliedLeadRef = useRef<number | null>(null);
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
  const [loaiTt, setLoaiTt] = useState<"toan_bo" | "co_coc" | "nhieu_phan">("toan_bo");
  const [tienCoc, setTienCoc] = useState("");
  const [daThanhToan, setDaThanhToan] = useState("");
  const [soTienDotNay, setSoTienDotNay] = useState("");
  const [dotThu, setDotThu] = useState("2");
  const [tongSoDot, setTongSoDot] = useState("3");
  const [hanThanhToan, setHanThanhToan] = useState("05 ngày");
  const [canCu, setCanCu] = useState("");
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
  }, []);

  useEffect(() => {
    function applyLeadDraft(draft: WebAdsDraftQuote) {
      appliedLeadRef.current = draft.lead_id;
      setActiveQuoteMode("standard");
      setTemplateKey("bao_gia");
      setSo((s) => (/\/(BG|DNTT|BBNT)-INUT$/.test(s) ? soDeXuat(ngay, "bao_gia") : s));
      setBenB((b) => ({
        ...b,
        name: draft.customer_name || b.name,
        email: draft.customer_email || b.email,
        address: draft.customer_address || b.address,
        mst: draft.customer_tax_code || b.mst,
        dai_dien: draft.customer_contact || b.dai_dien,
      }));
      if (Array.isArray(draft.items) && draft.items.length > 0) {
        setItems(
          draft.items.map((it) => ({
            ten: it.ten || "",
            dvt: it.dvt || "Bộ",
            so_luong: String(it.so_luong ?? 1),
            don_gia: it.don_gia != null ? String(it.don_gia) : "",
            thue_suat: String(it.thue_suat ?? 10),
          })),
        );
      }
      if (draft.note) {
        setThuyetMinh(draft.note);
      }
      if (draft.customer_id) {
        setSuggested({ id: draft.customer_id, name: draft.customer_name || `KH #${draft.customer_id}` });
      }
      setLinkedLeadId(draft.lead_id);
      setLeadBanner({
        leadId: draft.lead_id,
        customerName: draft.customer_name || "",
        contact: draft.customer_phone || draft.customer_contact || "",
      });
    }

    if (leadDraft && appliedLeadRef.current !== leadDraft.lead_id) {
      applyLeadDraft(leadDraft);
      onLeadDraftConsumed?.();
      return;
    }

    const urlLead = Number(new URLSearchParams(window.location.search).get("fromLead") || 0);
    const targetLeadId = fromLeadId && fromLeadId > 0 ? fromLeadId : urlLead > 0 ? urlLead : 0;
    if (targetLeadId > 0 && appliedLeadRef.current !== targetLeadId) {
      appliedLeadRef.current = targetLeadId;
      setActiveQuoteMode("standard");
      setLeadLoading(true);
      api
        .draftQuoteFromWebLead(targetLeadId)
        .then((draft) => {
          applyLeadDraft(draft);
          onLeadDraftConsumed?.();
        })
        .catch((ex) => {
          appliedLeadRef.current = null;
          setErr(`Không thể tải nháp báo giá từ Web Lead #${targetLeadId}: ${(ex as Error).message}`);
        })
        .finally(() => setLeadLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadDraft, fromLeadId]);

  useEffect(() => {
    const date = `${ngay.year}-${String(ngay.month).padStart(2, "0")}-${String(ngay.day).padStart(2, "0")}`;
    api
      .invAvailability(date)
      .then((r) => {
        const m = new Map<string, { qty: number; dvt: string }>();
        for (const row of r.rows) {
          const k = normName(row.ten);
          const current = m.get(k);
          m.set(k, { qty: (current?.qty ?? 0) + (row.kha_dung ?? row.ton), dvt: current?.dvt || row.dvt });
        }
        setStockByName(m);
      })
      .catch(() => {});
  }, [ngay.day, ngay.month, ngay.year]);

  const [newOrderPrompt, setNewOrderPrompt] = useState<string | null>(null);

  function newOrder() {
    const goiy = `${benB.name || "Khách"} — ${ngay.day}/${ngay.month}/${ngay.year}`;
    setNewOrderPrompt(goiy);
  }

  async function confirmNewOrder(name: string) {
    setNewOrderPrompt(null);
    if (!name.trim()) return;
    try {
      const o = await api.createOrder({ name: name.trim(), customer_id: suggested?.id ?? null });
      setOrders((arr) => [o, ...arr]);
      setOrderId(String(o.id));
      toast.success(`Đã tạo đơn hàng ${o.code}.`);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
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

  function switchTemplate(key: string) {
    setTemplateKey(key);
    setSo((s) => (/\/(BG|DNTT|BBNT)-INUT$/.test(s) ? soDeXuat(ngay, key) : s));
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
    toast.success("Đã bóc tách dữ liệu hóa đơn.");
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
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
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
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setParsing(false);
    }
  }

  function setItem(i: number, k: keyof QItem, v: string) {
    setItems((arr) =>
      arr.map((it, j) => {
        if (j !== i) return it;
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

  function addRow() {
    setItems((arr) => [...arr, { ten: "", dvt: "", so_luong: "1", don_gia: "", thue_suat: "10" }]);
  }

  function addFromCatalog(id: string) {
    const p = products.find((x) => x.id === Number(id));
    if (!p) return;
    setItems((arr) => {
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
      toast.success("AI đã sinh đoạn thuyết minh.");
    } catch (ex) {
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
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

  const previewDeps = JSON.stringify([
    templateKey, so, ngay, noiLap, benB, items, thuyetMinh, hieuLuc,
    loaiTt, tienCoc, daThanhToan, soTienDotNay, dotThu, tongSoDot,
    hanThanhToan, canCu, bbntGhiChu, bbntDieuKhoan,
  ]);

  useEffect(() => {
    if (activeQuoteMode !== "standard") return;
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
  }, [previewDeps, activeQuoteMode]);

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
      if (linkedLeadId) {
        await api
          .updateWebAdsLead(linkedLeadId, {
            status: "quoted",
            customer_id: r.customer_id ?? suggested?.id ?? undefined,
            quoted_price_vnd: Math.round(r.totals?.tong_truoc_thue ?? totals.truocThue),
          })
          .catch(() => {});
      }
      toast.success("Đã tạo chứng từ PDF.");
      onGenerated(
        r.doc_id,
        r.filename,
        r.doc_type,
        r.customer_id ?? suggested?.id ?? null,
        orderId ? Number(orderId) : null,
      );
    } catch (ex) {
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const missingUnitCount = items.filter((item) => item.ten.trim() && !item.dvt.trim()).length;

  return (
    <PageShell maxWidth="wide" className="quote-page" data-page="create-quote">
      <PageHeader
        variant="compact"
        icon="receipt"
        title="Tạo Báo giá / Đề nghị thanh toán"
        subtitle="Lập báo giá tiêu chuẩn, đề nghị thanh toán, BBNT hoặc giải pháp Billiards kèm xem trước PDF trực tiếp."
      />

      <ResponsiveTabs
        variant="segmented"
        tabs={[
          { id: "billiard", label: "Báo giá Billiards (Camera & Billiard Live)", icon: "camera" },
          { id: "standard", label: "Báo giá Tiêu chuẩn", icon: "file-text" },
        ]}
        active={activeQuoteMode}
        onChange={(id) => setActiveQuoteMode(id as "billiard" | "standard")}
        ariaLabel="Chế độ báo giá"
      />

      {activeQuoteMode === "billiard" ? (
        <BilliardQuoteTab onGenerated={onGenerated} />
      ) : (
        <SplitWorkspace
          variant="preview-right"
          stickySecondary
          mobileTabs={["Soạn chứng từ", "Xem trước PDF"]}
          primary={
            <div className="ui-stack--lg">
              {leadLoading && (
                <InlineAlert tone="info" title="Đang nạp thông tin báo giá từ Web Lead…">
                  <SkeletonBlock variant="line" lines={1} />
                </InlineAlert>
              )}

              {leadBanner && (
                <InlineAlert
                  tone="success"
                  title={`Đang lập báo giá từ Web Lead #${leadBanner.leadId}`}
                  action={
                    <AppButton
                      variant="ghost"
                      size="sm"
                      leftIcon="x"
                      onClick={() => {
                        setLinkedLeadId(null);
                        setLeadBanner(null);
                      }}
                    >
                      Bỏ gắn Lead
                    </AppButton>
                  }
                >
                  {leadBanner.customerName ? `${leadBanner.customerName}` : ""}
                  {leadBanner.contact ? ` (${leadBanner.contact})` : ""}
                  {" — khi sinh PDF sẽ tự cập nhật Lead sang trạng thái Đã báo giá."}
                </InlineAlert>
              )}

              <SectionCard title="Thiết lập chứng từ & nguồn dữ liệu" icon="sliders">
                <div className="ui-stack--sm">
                  <FormGrid cols={2}>
                    <FormField label="Loại chứng từ" htmlFor="q-template" fullWidth>
                      <select
                        id="q-template"
                        className="ui-select"
                        value={templateKey}
                        onChange={(e) => switchTemplate(e.target.value)}
                      >
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
                    </FormField>

                    <FormField label="Đơn hàng (gom Báo giá → BBBG → BBNT → Đề nghị TT)" htmlFor="q-order">
                      <select
                        id="q-order"
                        className="ui-select"
                        value={orderId}
                        onChange={(e) => setOrderId(e.target.value)}
                      >
                        <option value="">— không gắn đơn hàng —</option>
                        {orders.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.code} · {o.name} ({o.document_count} hồ sơ)
                          </option>
                        ))}
                      </select>
                    </FormField>

                    <div className="ui-row ui-row--bottom">
                      <AppButton variant="secondary" size="md" leftIcon="plus" onClick={newOrder}>
                        Tạo đơn hàng mới
                      </AppButton>
                    </div>

                    <FormField label="Nguồn hàng hóa" htmlFor="q-source">
                      <select
                        id="q-source"
                        className="ui-select"
                        value={source}
                        onChange={(e) => setSource(e.target.value as Source)}
                      >
                        <option value="tay">Nhập tay</option>
                        <option value="hoa_don">Từ hóa đơn (PDF/XML)</option>
                        <option value="ho_so">Từ hồ sơ có sẵn</option>
                      </select>
                    </FormField>

                    {source === "hoa_don" && (
                      <FormField label="Tải hóa đơn để tự điền" htmlFor="q-inv-file">
                        <input
                          id="q-inv-file"
                          className="ui-input"
                          type="file"
                          accept="application/pdf,.xml,text/xml,application/xml"
                          onChange={onInvoiceFile}
                        />
                      </FormField>
                    )}

                    {source === "ho_so" && (
                      <FormField label="Chọn hồ sơ (hóa đơn đã lưu)" htmlFor="q-stored-doc">
                        <select
                          id="q-stored-doc"
                          className="ui-select"
                          value={pickedDoc}
                          onChange={(e) => setPickedDoc(e.target.value)}
                        >
                          <option value="">— chọn hồ sơ —</option>
                          {docs.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.filename}
                              {d.customer_name ? ` · ${d.customer_name}` : ""}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    )}
                  </FormGrid>

                  {source === "ho_so" && (
                    <div>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="file-search"
                        loading={parsing}
                        disabled={!pickedDoc || parsing}
                        onClick={onParseStored}
                      >
                        Đọc hàng hóa từ hồ sơ
                      </AppButton>
                    </div>
                  )}

                  {parsing && <InlineAlert tone="info">Đang đọc hóa đơn…</InlineAlert>}
                  {parsed && (
                    <InlineAlert tone="success" title="Đã đọc dữ liệu — kiểm tra & sửa bên dưới">
                      {suggested ? (
                        <>Khách hàng đề xuất: <strong>{suggested.name}</strong> — sẽ tự gán khi ký.</>
                      ) : (
                        "Chưa khớp khách hàng trong CRM."
                      )}
                    </InlineAlert>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Thông tin chung" icon="calendar">
                <FormGrid cols={3}>
                  <FormField label="Số chứng từ" htmlFor="q-so">
                    <input id="q-so" className="ui-input" value={so} onChange={(e) => setSo(e.target.value)} />
                  </FormField>
                  <FormField label="Nơi lập" htmlFor="q-noi-lap">
                    <input
                      id="q-noi-lap"
                      className="ui-input"
                      placeholder={isDntt ? "TP.HCM (mặc định)" : "Đắk Lắk (mặc định)"}
                      value={noiLap}
                      onChange={(e) => setNoiLap(e.target.value)}
                    />
                  </FormField>
                  {!isDntt && !isBbnt && (
                    <FormField label="Hiệu lực báo giá (ngày)" htmlFor="q-hieu-luc">
                      <input id="q-hieu-luc" className="ui-input" value={hieuLuc} onChange={(e) => setHieuLuc(e.target.value)} />
                    </FormField>
                  )}
                  <FormField label="Ngày" htmlFor="q-day">
                    <input
                      id="q-day"
                      className="ui-input"
                      type="number"
                      value={ngay.day}
                      onChange={(e) => setNgay({ ...ngay, day: +e.target.value })}
                    />
                  </FormField>
                  <FormField label="Tháng" htmlFor="q-month">
                    <input
                      id="q-month"
                      className="ui-input"
                      type="number"
                      value={ngay.month}
                      onChange={(e) => setNgay({ ...ngay, month: +e.target.value })}
                    />
                  </FormField>
                  <FormField label="Năm" htmlFor="q-year">
                    <input
                      id="q-year"
                      className="ui-input"
                      type="number"
                      value={ngay.year}
                      onChange={(e) => setNgay({ ...ngay, year: +e.target.value })}
                    />
                  </FormField>
                </FormGrid>
              </SectionCard>

              <SmartPartyPaste
                onApply={(data) =>
                  setBenB((current) => ({
                    ...current,
                    name: data.name || current.name,
                    address: data.address || current.address,
                    mst: data.mst || current.mst,
                    email: data.email || current.email,
                    dai_dien: data.dai_dien || current.dai_dien,
                  }))
                }
              />

              <SectionCard title="Khách hàng (Kính gửi)" icon="building-2">
                <FormGrid cols={2}>
                  <FormField label="Tên đơn vị" htmlFor="q-buyer-name" fullWidth required>
                    <input
                      id="q-buyer-name"
                      className="ui-input"
                      value={benB.name}
                      onChange={(e) => setBenB({ ...benB, name: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Địa chỉ" htmlFor="q-buyer-addr" fullWidth>
                    <input
                      id="q-buyer-addr"
                      className="ui-input"
                      value={benB.address}
                      onChange={(e) => setBenB({ ...benB, address: e.target.value })}
                    />
                  </FormField>
                  <FormField label="MST" htmlFor="q-buyer-mst">
                    <input
                      id="q-buyer-mst"
                      className="ui-input"
                      value={benB.mst}
                      onChange={(e) => setBenB({ ...benB, mst: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Email" htmlFor="q-buyer-email">
                    <input
                      id="q-buyer-email"
                      className="ui-input"
                      value={benB.email}
                      onChange={(e) => setBenB({ ...benB, email: e.target.value })}
                    />
                  </FormField>
                  {isBbnt && (
                    <>
                      <FormField label="Đại diện (bên mua)" htmlFor="q-buyer-rep">
                        <input
                          id="q-buyer-rep"
                          className="ui-input"
                          placeholder="vd: Ông Lê Xuân Tú"
                          value={benB.dai_dien}
                          onChange={(e) => setBenB({ ...benB, dai_dien: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Tên gọi tắt (in trong BBNT)" htmlFor="q-buyer-short">
                        <input
                          id="q-buyer-short"
                          className="ui-input"
                          placeholder="vd: PHE VIET NAM"
                          value={benB.ten_ngan}
                          onChange={(e) => setBenB({ ...benB, ten_ngan: e.target.value })}
                        />
                      </FormField>
                    </>
                  )}
                </FormGrid>
              </SectionCard>

              <SectionCard
                title="Danh sách hàng hóa / hạng mục"
                icon="package"
                actions={
                  <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={addRow}>
                    Thêm dòng
                  </AppButton>
                }
              >
                <div className="ui-stack--sm">
                  <FormField
                    label={`Thêm nhanh từ danh mục đã dùng (${products.length} món)`}
                    htmlFor="q-catalog-pick"
                  >
                    <select
                      id="q-catalog-pick"
                      className="ui-select"
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
                  </FormField>

                  <datalist id="pl-products">
                    {products.map((p) => (
                      <option key={p.id} value={p.ten} />
                    ))}
                  </datalist>

                  {missingUnitCount > 0 && (
                    <InlineAlert tone="warning">
                      Thiếu đơn vị tính ở {missingUnitCount} dòng — cần bổ sung trước khi lập biểu.
                    </InlineAlert>
                  )}

                  <DataView
                    mobileMode="scroll"
                    empty={
                      items.length === 0 ? (
                        <EmptyState
                          compact
                          icon="package"
                          title="Chưa có hạng mục"
                          description="Chọn từ danh mục hoặc nhấn Thêm dòng để lập báo giá."
                          action={
                            <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={addRow}>
                              Thêm dòng
                            </AppButton>
                          }
                        />
                      ) : undefined
                    }
                    desktop={
                      <table className="doc-table studio-line-table">
                        <thead>
                          <tr>
                            <th>Tên hàng hóa / dịch vụ</th>
                            <th className="col-unit">ĐVT</th>
                            <th className="col-qty">SL</th>
                            <th className="col-price">Đơn giá</th>
                            <th className="col-amount">Thành tiền</th>
                            <th className="col-vat">Thuế (%)</th>
                            <th className="col-tax">Tiền thuế</th>
                            <th className="col-act">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, i) => {
                            const tt = Math.round(parseNum(it.so_luong) * parseNum(it.don_gia));
                            const thue = Math.round((tt * parseNum(it.thue_suat)) / 100);
                            const stock = it.ten.trim() ? stockByName.get(normName(it.ten)) : undefined;
                            const du = stock ? stock.qty >= parseNum(it.so_luong) : false;
                            return (
                              <tr key={i}>
                                <td>
                                  <div className="ui-stack--xs">
                                    <input
                                      className="ui-input"
                                      aria-label={`Tên hàng hóa dòng ${i + 1}`}
                                      value={it.ten}
                                      list="pl-products"
                                      placeholder="gõ để gợi ý từ danh mục…"
                                      onChange={(e) => setItem(i, "ten", e.target.value)}
                                    />
                                    {stock && (
                                      <div>
                                        <StatusBadge
                                          size="sm"
                                          tone={du ? "success" : "danger"}
                                          dot
                                          title={`Khả dụng tại ngày ${ngay.day}/${ngay.month}/${ngay.year} (báo giá không trừ kho)`}
                                        >
                                          Tồn ngày {ngay.day}/{ngay.month}: {stock.qty} {stock.dvt || "(thiếu ĐVT)"}
                                        </StatusBadge>
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <input
                                    aria-label={`Đơn vị tính dòng ${i + 1}`}
                                    className={`ui-input${it.ten.trim() && !it.dvt.trim() ? " field-missing" : ""}`}
                                    value={it.dvt}
                                    placeholder={it.ten.trim() ? "Thiếu ĐVT" : ""}
                                    onChange={(e) => setItem(i, "dvt", e.target.value)}
                                  />
                                </td>
                                <td>
                                  <input
                                    aria-label={`Số lượng dòng ${i + 1}`}
                                    className="ui-input ui-num"
                                    value={it.so_luong}
                                    onChange={(e) => setItem(i, "so_luong", e.target.value)}
                                  />
                                </td>
                                <td>
                                  <input
                                    aria-label={`Đơn giá dòng ${i + 1}`}
                                    className="ui-input ui-num"
                                    value={it.don_gia}
                                    onChange={(e) => setItem(i, "don_gia", e.target.value)}
                                  />
                                </td>
                                <td className="ui-num">{vnd(tt)}</td>
                                <td>
                                  <select
                                    aria-label={`Thuế suất dòng ${i + 1}`}
                                    className="ui-select"
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
                                <td className="ui-num">{vnd(thue)}</td>
                                <td>
                                  <AppButton
                                    variant="ghost"
                                    size="sm"
                                    iconOnly
                                    leftIcon="trash"
                                    aria-label={`Xóa dòng ${i + 1}`}
                                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    }
                  />

                  {isBbnt ? (
                    <InlineAlert tone="info">
                      BBNT không in giá — chỉ dùng tên hạng mục, ĐVT và số lượng.
                    </InlineAlert>
                  ) : (
                    <div className="ui-totals-grid">
                      <div className="ui-total-cell">
                        <span>Cộng tiền hàng</span>
                        <strong>{vnd(totals.truocThue)} đ</strong>
                      </div>
                      <div className="ui-total-cell">
                        <span>Thuế GTGT</span>
                        <strong>{vnd(totals.thue)} đ</strong>
                      </div>
                      <div className="ui-total-cell is-grand">
                        <span>TỔNG THANH TOÁN</span>
                        <strong>{vnd(totals.tong)} đ</strong>
                      </div>
                    </div>
                  )}
                </div>
              </SectionCard>

              {isBbnt && (
                <SectionCard title="Biên bản nghiệm thu" icon="clipboard-check">
                  <div className="ui-stack--sm">
                    <FormField label="Ghi chú in trên từng hạng mục" htmlFor="q-bbnt-note">
                      <input
                        id="q-bbnt-note"
                        className="ui-input"
                        value={bbntGhiChu}
                        onChange={(e) => setBbntGhiChu(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Điều kiện bảo hành / điều khoản" htmlFor="q-bbnt-terms">
                      <textarea
                        id="q-bbnt-terms"
                        className="ui-textarea"
                        rows={5}
                        placeholder="Để trống = dùng điều kiện bảo hành mặc định của INUT (1 năm 1 đổi 1, loại trừ hư hỏng do vận hành sai, hỏa hoạn, tự ý sửa chữa…)"
                        value={bbntDieuKhoan}
                        onChange={(e) => setBbntDieuKhoan(e.target.value)}
                      />
                    </FormField>
                  </div>
                </SectionCard>
              )}

              {isDntt && (
                <SectionCard title="Đề nghị thanh toán" icon="wallet">
                  <div className="ui-stack--sm">
                    <FormGrid cols={2}>
                      <FormField label="Loại thanh toán" htmlFor="q-loai-tt">
                        <select
                          id="q-loai-tt"
                          className="ui-select"
                          value={loaiTt}
                          onChange={(e) => setLoaiTt(e.target.value as typeof loaiTt)}
                        >
                          <option value="toan_bo">Thanh toán toàn bộ</option>
                          <option value="co_coc">Đã đặt cọc — thanh toán phần còn lại</option>
                          <option value="nhieu_phan">Thanh toán nhiều đợt</option>
                        </select>
                      </FormField>
                      <FormField label="Căn cứ (tùy chọn)" htmlFor="q-can-cu">
                        <input
                          id="q-can-cu"
                          className="ui-input"
                          placeholder="vd: theo hợp đồng số 01/2026/HĐKT"
                          value={canCu}
                          onChange={(e) => setCanCu(e.target.value)}
                        />
                      </FormField>
                      {(loaiTt === "co_coc" || loaiTt === "nhieu_phan") && (
                        <FormField label="Số tiền đã đặt cọc" htmlFor="q-tien-coc">
                          <input id="q-tien-coc" className="ui-input" value={tienCoc} onChange={(e) => setTienCoc(e.target.value)} />
                        </FormField>
                      )}
                      {loaiTt === "nhieu_phan" && (
                        <>
                          <FormField label="Đã thanh toán các đợt trước" htmlFor="q-da-tt">
                            <input id="q-da-tt" className="ui-input" value={daThanhToan} onChange={(e) => setDaThanhToan(e.target.value)} />
                          </FormField>
                          <FormField label="Số tiền đợt này (trống = tự tính phần còn lại)" htmlFor="q-dot-nay">
                            <input id="q-dot-nay" className="ui-input" value={soTienDotNay} onChange={(e) => setSoTienDotNay(e.target.value)} />
                          </FormField>
                          <FormField label="Đợt thứ" htmlFor="q-dot-thu">
                            <input id="q-dot-thu" className="ui-input" value={dotThu} onChange={(e) => setDotThu(e.target.value)} />
                          </FormField>
                          <FormField label="Tổng số đợt" htmlFor="q-tong-dot">
                            <input id="q-tong-dot" className="ui-input" value={tongSoDot} onChange={(e) => setTongSoDot(e.target.value)} />
                          </FormField>
                        </>
                      )}
                      <FormField label="Hạn thanh toán" htmlFor="q-han-tt">
                        <input id="q-han-tt" className="ui-input" value={hanThanhToan} onChange={(e) => setHanThanhToan(e.target.value)} />
                      </FormField>
                    </FormGrid>
                    <div className="ui-total-cell is-grand">
                      <span>{loaiTt === "nhieu_phan" ? "SỐ TIỀN ĐỢT NÀY" : "CÒN LẠI CẦN THANH TOÁN"}</span>
                      <strong>{vnd(conLai)} đ</strong>
                    </div>
                  </div>
                </SectionCard>
              )}

              {!isBbnt && (
                <SectionCard
                  title="Thuyết minh (tùy chọn)"
                  icon="sparkles"
                  actions={
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="bot"
                      loading={aiBusy}
                      disabled={aiBusy || !aiInfo?.enabled || itemsPayload().length === 0}
                      onClick={genNarrative}
                      title={aiInfo?.enabled ? `Model: ${aiInfo.model}` : "Chưa cấu hình AI trong .env"}
                    >
                      {aiBusy ? "AI đang viết…" : "Sinh thuyết minh (AI)"}
                    </AppButton>
                  }
                >
                  <div className="ui-stack--sm">
                    {aiInfo && !aiInfo.enabled && (
                      <InlineAlert tone="info">
                        Chưa cấu hình AI (đặt AI_ENABLED=true trong .env) để sinh thuyết minh tự động.
                      </InlineAlert>
                    )}
                    <FormField label="Gợi ý thêm cho AI (tùy chọn)" htmlFor="q-ai-note">
                      <input
                        id="q-ai-note"
                        className="ui-input"
                        placeholder="vd: nhấn mạnh bảo hành 24 tháng, triển khai trong 2 tuần"
                        value={aiNote}
                        onChange={(e) => setAiNote(e.target.value)}
                      />
                    </FormField>
                    <FormField label="Nội dung thuyết minh" htmlFor="q-narrative">
                      <textarea
                        id="q-narrative"
                        className="ui-textarea"
                        rows={5}
                        placeholder="Đoạn giới thiệu/thuyết minh in trên chứng từ — có thể tự viết hoặc bấm nút AI rồi sửa lại."
                        value={thuyetMinh}
                        onChange={(e) => setThuyetMinh(e.target.value)}
                      />
                    </FormField>
                  </div>
                </SectionCard>
              )}

              {err && <InlineAlert tone="danger" onDismiss={() => setErr("")}>{err}</InlineAlert>}

              <AppButton
                variant="primary"
                size="lg"
                fullWidth
                leftIcon="file-signature"
                loading={busy}
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
              </AppButton>
            </div>
          }
          secondary={
            <SectionCard
              title="Xem trước PDF"
              icon="eye"
              padding="compact"
              actions={
                <StatusBadge tone={previewBusy ? "info" : "neutral"} size="sm">
                  {previewBusy ? "Đang cập nhật…" : "Tự cập nhật khi sửa"}
                </StatusBadge>
              }
            >
              <div className="ui-stack--sm">
                {previewErr && <InlineAlert tone="danger">{previewErr}</InlineAlert>}
                {previewUrl ? (
                  <iframe
                    className="ui-iframe-tall"
                    src={previewUrl + "#toolbar=0&navpanes=0"}
                    title="Xem trước PDF"
                  />
                ) : (
                  <EmptyState
                    compact
                    icon="file-search"
                    title="Đang tạo bản xem trước…"
                    description="Bản PDF sẽ hiển thị tự động ngay sau khi nạp xong."
                  />
                )}
              </div>
            </SectionCard>
          }
        />
      )}

      <PromptDialog
        open={newOrderPrompt !== null}
        title="Tạo đơn hàng mới"
        label="Tên đơn hàng mới"
        defaultValue={newOrderPrompt ?? ""}
        onConfirm={confirmNewOrder}
        onCancel={() => setNewOrderPrompt(null)}
      />
    </PageShell>
  );
}
