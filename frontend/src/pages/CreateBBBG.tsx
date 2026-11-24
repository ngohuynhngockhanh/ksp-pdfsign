import { useEffect, useState } from "react";
import { api } from "../api";
import { SmartPartyPaste } from "../components/SmartPartyPaste";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  PageHeader,
  PageShell,
  SectionCard,
  SplitWorkspace,
  StatusBadge,
  StepFlow,
  useToast,
} from "../components/ui";

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
  const toast = useToast();
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
      toast.success("AI đã bóc tách dữ liệu từ hóa đơn.");
    } catch (ex) {
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setParsing(false);
    }
  }

  function setItem(i: number, k: keyof Item, v: string) {
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  }

  function addItem() {
    setItems((arr) => [...arr, { ten: "", dvt: "", so_luong: "" }]);
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
      toast.success("Đã sinh biên bản bàn giao.");
      onGenerated(r.doc_id, r.filename, r.customer_id ?? suggested?.id ?? null);
    } catch (ex) {
      const msg = (ex as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const missingUnits = items.filter((item) => item.ten.trim() && !item.dvt.trim()).length;
  const ready = parsed && Boolean(benB.name.trim()) && items.length > 0 && missingUnits === 0;

  return (
    <PageShell className="bbbg-studio" data-page="create-bbbg">
      <PageHeader
        variant="compact"
        icon="file-check"
        title="Biên bản bàn giao, từ hóa đơn đến bản ký."
        subtitle="Đưa file hóa đơn nguồn vào một lần; CRM tự bóc tách bên nhận, hàng hóa và ngày chứng từ."
        actions={
          <StatusBadge tone={ready ? "success" : "neutral"} dot>
            {ready ? "Hồ sơ hợp lệ" : "Đang soạn"}
          </StatusBadge>
        }
      />

      <StepFlow
        className="studio-step-flow"
        ariaLabel="Quy trình tạo biên bản"
        steps={[
          { id: "parse", label: "AI đọc hóa đơn", done: parsed, active: !parsed },
          { id: "review", label: "Kiểm tra dữ liệu", done: ready, active: parsed && !ready },
          { id: "sign", label: "Sinh PDF & ký", active: ready },
        ]}
      />

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {parsed && (
        <InlineAlert
          tone="success"
          title="AI đã điền dữ liệu nguồn"
        >
          <strong>{suggested ? `Khớp khách hàng: ${suggested.name}` : "Chưa khớp khách hàng trong CRM"}</strong>
          {" — Hãy duyệt thông tin bên nhận và tồn kho trước khi tạo bản ký."}
        </InlineAlert>
      )}

      <SplitWorkspace
        variant="preview-right"
        stickySecondary
        primary={
          <div className="ui-stack--lg">
            <SectionCard
              eyebrow="HÓA ĐƠN NGUỒN"
              title="Nạp file PDF / XML để AI tự điền"
              subtitle="Ưu tiên file XML hóa đơn điện tử để đọc chính xác MST, đơn vị tính và số lượng."
              icon="upload"
            >
              <label className={`ui-dropzone${parsed ? " is-parsed" : ""}`}>
                <input
                  aria-label="Hóa đơn nguồn"
                  type="file"
                  accept="application/pdf,.xml,text/xml,application/xml"
                  onChange={onInvoice}
                />
                <span className="ui-dropzone-icon" aria-hidden="true">
                  <AppIcon name={parsing ? "loader" : parsed ? "file-check" : "upload"} size={20} className={parsing ? "ui-spin" : ""} />
                </span>
                <div className="ui-dropzone-copy">
                  <strong>{parsing ? "AI đang bóc tách dữ liệu…" : parsed ? "Đã nhận hóa đơn — chọn để đổi file khác" : "Thả hoặc chọn file hóa đơn PDF / XML"}</strong>
                  <small>Hỗ trợ hóa đơn điện tử XML và bản thể hiện PDF</small>
                </div>
                <StatusBadge tone={parsed ? "success" : "brand"} size="sm">
                  {parsing ? "Đang đọc" : parsed ? "Đã nhận" : "Chọn file"}
                </StatusBadge>
              </label>
            </SectionCard>

            <SectionCard
              eyebrow="01 · THÔNG TIN BIÊN BẢN"
              title="Dấu mốc của hồ sơ"
              icon="calendar"
            >
              <FormGrid cols={3}>
                <FormField label="Số BB" htmlFor="bbbg-so-bb">
                  <input id="bbbg-so-bb" className="ui-input" value={soBb} onChange={(e) => setSoBb(e.target.value)} />
                </FormField>
                <FormField label="Nơi lập" htmlFor="bbbg-noi-lap">
                  <input id="bbbg-noi-lap" className="ui-input" value={noiLap} onChange={(e) => setNoiLap(e.target.value)} />
                </FormField>
                <FormField label="Mẫu template" htmlFor="bbbg-template">
                  <select id="bbbg-template" className="ui-select" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                    {templates.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Ngày" htmlFor="bbbg-day">
                  <input id="bbbg-day" className="ui-input" type="number" value={ngay.day} onChange={(e) => setNgay({ ...ngay, day: +e.target.value })} />
                </FormField>
                <FormField label="Tháng" htmlFor="bbbg-month">
                  <input id="bbbg-month" className="ui-input" type="number" value={ngay.month} onChange={(e) => setNgay({ ...ngay, month: +e.target.value })} />
                </FormField>
                <FormField label="Năm" htmlFor="bbbg-year">
                  <input id="bbbg-year" className="ui-input" type="number" value={ngay.year} onChange={(e) => setNgay({ ...ngay, year: +e.target.value })} />
                </FormField>
              </FormGrid>
            </SectionCard>

            <SmartPartyPaste
              onApply={(data) =>
                setBenB((current) => ({
                  ...current,
                  ...Object.fromEntries(Object.entries(data).filter(([, value]) => value)),
                }))
              }
            />

            <SectionCard
              eyebrow="02 · BÊN NHẬN"
              title="Ai nhận bàn giao?"
              subtitle="Kiểm tra hoặc chỉnh trực tiếp thông tin đơn vị nhận bàn giao."
              icon="building-2"
            >
              <FormGrid cols={2}>
                <FormField label="Tên đơn vị" htmlFor="bbbg-name" fullWidth required>
                  <input id="bbbg-name" className="ui-input" value={benB.name} onChange={(e) => setBenB({ ...benB, name: e.target.value })} />
                </FormField>
                <FormField label="Địa chỉ" htmlFor="bbbg-address" fullWidth>
                  <input id="bbbg-address" className="ui-input" value={benB.address} onChange={(e) => setBenB({ ...benB, address: e.target.value })} />
                </FormField>
                <FormField label="Mã số thuế" htmlFor="bbbg-mst">
                  <input id="bbbg-mst" className="ui-input" value={benB.mst} onChange={(e) => setBenB({ ...benB, mst: e.target.value })} />
                </FormField>
                <FormField label="Đại diện" htmlFor="bbbg-rep">
                  <input id="bbbg-rep" className="ui-input" value={benB.dai_dien} onChange={(e) => setBenB({ ...benB, dai_dien: e.target.value })} />
                </FormField>
                <FormField label="Chức vụ" htmlFor="bbbg-role">
                  <input id="bbbg-role" className="ui-input" value={benB.chuc_vu} onChange={(e) => setBenB({ ...benB, chuc_vu: e.target.value })} />
                </FormField>
                <FormField label="Người nhận" htmlFor="bbbg-receiver">
                  <input id="bbbg-receiver" className="ui-input" value={benB.nguoi_nhan} onChange={(e) => setBenB({ ...benB, nguoi_nhan: e.target.value })} />
                </FormField>
                <FormField label="Điện thoại" htmlFor="bbbg-phone">
                  <input id="bbbg-phone" className="ui-input" value={benB.dien_thoai} onChange={(e) => setBenB({ ...benB, dien_thoai: e.target.value })} />
                </FormField>
                <FormField label="Email" htmlFor="bbbg-email">
                  <input id="bbbg-email" className="ui-input" value={benB.email} onChange={(e) => setBenB({ ...benB, email: e.target.value })} />
                </FormField>
              </FormGrid>
            </SectionCard>

            <SectionCard
              eyebrow="03 · HÀNG HÓA"
              title="Danh mục bàn giao"
              subtitle="Đối chiếu số lượng với tồn kho khả dụng tại ngày lập biên bản."
              icon="package"
              actions={
                <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={addItem}>
                  Thêm hàng hóa
                </AppButton>
              }
            >
              <div className="ui-stack--sm">
                {missingUnits > 0 && (
                  <InlineAlert tone="warning">
                    Có {missingUnits} dòng thiếu đơn vị tính — cần bổ sung trước khi tạo biên bản.
                  </InlineAlert>
                )}

                <DataView
                  mobileMode="scroll"
                  empty={
                    items.length === 0 ? (
                      <EmptyState
                        compact
                        icon="package"
                        title="Chưa có hàng hóa bàn giao"
                        description="Tải hóa đơn PDF/XML ở trên hoặc thêm dòng thủ công."
                        action={
                          <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={addItem}>
                            Thêm hàng hóa
                          </AppButton>
                        }
                      />
                    ) : undefined
                  }
                  desktop={
                    <table className="doc-table studio-line-table">
                      <thead>
                        <tr>
                          <th>Tên hàng hóa</th>
                          <th className="col-unit">Đơn vị</th>
                          <th className="col-qty">Số lượng</th>
                          <th className="col-act">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, i) => {
                          const stock = stockByName.get(normName(it.ten));
                          const enough = (stock?.qty ?? 0) >= Number(it.so_luong || 0);
                          return (
                            <tr key={i}>
                              <td>
                                <div className="ui-stack--xs">
                                  <input
                                    className="ui-input"
                                    aria-label={`Tên hàng hóa dòng ${i + 1}`}
                                    value={it.ten}
                                    onChange={(e) => setItem(i, "ten", e.target.value)}
                                  />
                                  {stock && (
                                    <div>
                                      <StatusBadge size="sm" tone={enough ? "success" : "danger"} dot>
                                        Tồn {ngay.day}/{ngay.month}: {stock.qty} {stock.dvt || "(thiếu ĐVT)"}
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
                                <AppButton
                                  variant="ghost"
                                  size="sm"
                                  leftIcon="trash"
                                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                                >
                                  Xóa
                                </AppButton>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  }
                />
              </div>
            </SectionCard>
          </div>
        }
        secondary={
          <SectionCard
            eyebrow="TRẠNG THÁI HỒ SƠ"
            title={ready ? "Sẵn sàng tạo biên bản" : "Cần hoàn thiện dữ liệu"}
            icon={ready ? "check-circle" : "clipboard-check"}
            footer={
              <div className="ui-stack--sm">
                <AppButton
                  variant="primary"
                  size="lg"
                  fullWidth
                  leftIcon="file-signature"
                  loading={busy}
                  disabled={busy || !benB.name || items.length === 0}
                  onClick={generate}
                >
                  {busy ? "Đang sinh PDF…" : "Sinh BBBG → Ký ngay"}
                </AppButton>
                <span className="ui-muted">
                  PDF được tạo ở bước kế tiếp; dữ liệu hiện tại vẫn có thể kiểm tra trước khi ký.
                </span>
              </div>
            }
          >
            <div className="ui-stack--xs">
              <div className="ui-kv-row">
                <span>Bên nhận</span>
                <strong>{benB.name || "Chưa có"}</strong>
              </div>
              <div className="ui-kv-row">
                <span>Hàng hóa</span>
                <strong>{items.length} dòng</strong>
              </div>
              <div className="ui-kv-row">
                <span>Đơn vị tính</span>
                <StatusBadge size="sm" tone={missingUnits ? "warning" : "success"}>
                  {missingUnits ? `Thiếu ${missingUnits} dòng` : "Đầy đủ"}
                </StatusBadge>
              </div>
              <div className="ui-kv-row">
                <span>Mẫu</span>
                <strong>{templates.find((item) => item.key === templateKey)?.label || templateKey}</strong>
              </div>
            </div>
          </SectionCard>
        }
      />
    </PageShell>
  );
}
