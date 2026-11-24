import { useEffect, useMemo, useState } from "react";
import { api, type OperationsDashboard, type TaxReport } from "../api";
import {
  AppButton,
  AppIcon,
  EmptyState,
  InlineAlert,
  KpiStrip,
  PageHeader,
  PageShell,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  useToast,
  type KpiItem,
  type StatusBadgeTone,
} from "../components/ui";

function previousQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return q === 1 ? `${d.getFullYear() - 1}-Q4` : `${d.getFullYear()}-Q${q - 1}`;
}

const STATE_LABEL: Record<string, string> = {
  missing: "Thiếu file nguồn",
  renderable: "Có thể dựng PDF",
  source_only: "Chỉ có XML",
};

const SYNC_TONE: Record<string, StatusBadgeTone> = {
  success: "success",
  completed: "success",
  failed: "danger",
  needs_action: "danger",
  running: "info",
};

export function Operations({ navigate }: { navigate: (tab: string) => void }) {
  const toast = useToast();
  const [data, setData] = useState<OperationsDashboard | null>(null);
  const [reports, setReports] = useState<TaxReport[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ky, setKy] = useState(previousQuarter());

  async function load() {
    try {
      const [dashboard, reportRows] = await Promise.all([
        api.operationsDashboard(),
        api.taxReports(),
      ]);
      setData(dashboard);
      setReports(reportRows);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const actionable = useMemo(
    () => data?.document_queue?.slice(0, 12) ?? [],
    [data],
  );

  async function runSync() {
    setBusy("sync");
    try {
      await api.runTaxSyncJob();
      await load();
      toast.success("Đã chạy đồng bộ thuế thành công.");
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  }

  async function generate() {
    setBusy("report");
    try {
      await api.generateTaxReport(ky);
      await load();
      toast.success(`Đã cập nhật tờ khai nội bộ kỳ ${ky}.`);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  }

  async function attachPdf(id: number, file?: File) {
    if (!file) return;
    setBusy(`pdf-${id}`);
    try {
      await api.attachPurchasePdf(id, file);
      await load();
      toast.success("Đã nộp file PDF bổ sung.");
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  }

  const headerNode = (
    <PageHeader
      variant="hero"
      eyebrow="INUT · TRUNG TÂM VẬN HÀNH"
      title="Mọi việc cần duyệt, ở một chỗ."
      subtitle="Hóa đơn, chứng từ và tờ khai được theo dõi liên tục — CRM không tự ghi sổ hay nộp thuế."
      actions={
        <AppButton
          variant="gold"
          leftIcon="refresh"
          loading={busy === "sync"}
          disabled={Boolean(busy)}
          onClick={runSync}
        >
          {busy === "sync" ? "Đang đồng bộ…" : "Đồng bộ thuế ngay"}
        </AppButton>
      }
    />
  );

  if (!data) {
    return (
      <PageShell data-page="operations">
        {headerNode}
        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        <KpiStrip items={[]} loading columns={4} />
        <section className="ops-grid" aria-busy="true" aria-label="Đang tổng hợp trung tâm vận hành">
          <SectionCard eyebrow="Hàng chờ" title="Chứng từ cần hoàn thiện" icon="clipboard-list">
            <SkeletonBlock variant="card" lines={2} />
          </SectionCard>
          <SectionCard eyebrow="Đối chiếu quý" title="Tờ khai nội bộ" icon="file-spreadsheet">
            <SkeletonBlock variant="card" lines={2} />
          </SectionCard>
        </section>
      </PageShell>
    );
  }

  const sync = data.latest_sync;
  const noPdfCount = data.documents.renderable + data.documents.source_only;
  const syncStatus = sync?.status || "none";
  const syncBadgeTone: StatusBadgeTone = SYNC_TONE[syncStatus] ?? "neutral";

  const kpiItems: KpiItem[] = [
    {
      label: "Hóa đơn mua",
      value: data.purchases,
      sub: `${data.purchase_drafts} bản nháp chờ duyệt`,
      tone: "brand",
      icon: "file-down",
    },
    {
      label: "Hóa đơn bán",
      value: data.sales,
      sub: `${data.sale_drafts} bản nháp`,
      tone: "neutral",
      icon: "receipt",
    },
    {
      label: "Thiếu chứng từ",
      value: data.documents.missing,
      sub: "Cần tìm hoặc tải lại file gốc",
      tone: data.documents.missing > 0 ? "danger" : "success",
      icon: "file-warning",
    },
    {
      label: "Chưa có PDF",
      value: noPdfCount,
      sub: `${data.documents.renderable} bản có thể dựng ngay`,
      tone: noPdfCount > 0 ? "warning" : "success",
      icon: "file-text",
    },
  ];

  return (
    <PageShell data-page="operations">
      {headerNode}

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {sync?.needs_action && (
        <AppButton
          variant="ghost"
          className="ui-alert-cta ops-alert--critical"
          onClick={() => navigate("thuesync")}
        >
          <span className="ui-alert-cta-icon" aria-hidden="true">
            <AppIcon name="alert-triangle" size={18} />
          </span>
          <span className="ui-stack--xs ops-alert-copy">
            <strong>Cần đăng nhập lại cổng thuế</strong>
            <small>{sync.error}</small>
          </span>
          <span className="ui-alert-cta-action">
            Mở xử lý <AppIcon name="arrow-right" size={15} />
          </span>
        </AppButton>
      )}

      <KpiStrip items={kpiItems} columns={4} />

      <section className="ops-grid">
        <SectionCard
          eyebrow="Hàng chờ"
          title="Chứng từ cần hoàn thiện"
          icon="clipboard-list"
          actions={
            <AppButton
              variant="ghost"
              size="sm"
              rightIcon="arrow-right"
              className="ui-nowrap ui-shrink-0"
              onClick={() => navigate("nhaphang")}
            >
              Mở Nhập hàng
            </AppButton>
          }
        >
          <div className="ui-stack--sm">
            {actionable.length === 0 ? (
              <EmptyState
                compact
                icon="check-circle"
                title="Tất cả chứng từ đã sẵn sàng."
                description="Không có hóa đơn nào thiếu file gốc hoặc chờ dựng PDF."
              />
            ) : (
              actionable.map((x) => {
                const isMissing = x.state === "missing";
                return (
                  <div
                    className={`ops-action-row${isMissing ? " is-missing ops-missing-pulse" : ""}`}
                    key={`${x.kind}-${x.id}`}
                  >
                    <span
                      className={`ops-status-dot${isMissing ? " is-danger" : " is-warning"}`}
                      aria-hidden="true"
                    />
                    <div className="ops-action-main">
                      <strong>
                        {x.so_hd || `#${x.id}`} · {x.partner || "Chưa rõ đối tác"}
                      </strong>
                      <small>
                        {x.ngay} · {x.kind === "purchase" ? "Mua vào" : "Bán ra"}
                      </small>
                    </div>
                    <StatusBadge tone={isMissing ? "danger" : "warning"} size="sm">
                      {STATE_LABEL[x.state] ?? x.state}
                    </StatusBadge>
                    {x.kind === "purchase" && x.state === "renderable" && (
                      <a
                        className="ui-btn ui-btn--secondary ui-btn--sm ui-nowrap ui-shrink-0"
                        href={`/api/inv/purchase/${x.id}/pdf`}
                      >
                        <AppIcon name="file-down" size={14} />
                        <span>Dựng PDF</span>
                      </a>
                    )}
                    {x.kind === "purchase" &&
                      (x.state === "missing" || x.state === "source_only") && (
                        <label
                          className={`ui-btn ui-btn--secondary ui-btn--sm ui-nowrap ui-shrink-0 ui-clickable${busy === `pdf-${x.id}` ? " is-loading" : ""}`}
                        >
                          <AppIcon name="upload" size={14} />
                          <span>
                            {busy === `pdf-${x.id}` ? "Đang nộp…" : "Nộp PDF bù"}
                          </span>
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            hidden
                            disabled={Boolean(busy)}
                            onChange={(e) => attachPdf(x.id, e.target.files?.[0])}
                          />
                        </label>
                      )}
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Đối chiếu quý"
          title="Tờ khai nội bộ"
          icon="file-spreadsheet"
          footer={
            <AppButton
              variant="secondary"
              fullWidth
              rightIcon="arrow-right"
              onClick={() => navigate("thuebct")}
            >
              Review file kế toán và đối chiếu
            </AppButton>
          }
        >
          <div className="ops-quarter-form">
            <input
              className="ui-input ops-quarter-input"
              aria-label="Kỳ đối chiếu quý"
              value={ky}
              onChange={(e) => setKy(e.target.value.toUpperCase())}
            />
            <AppButton
              variant="primary"
              loading={busy === "report"}
              disabled={Boolean(busy)}
              onClick={generate}
            >
              {busy === "report" ? "Đang sinh…" : "Sinh / cập nhật"}
            </AppButton>
          </div>

          <div className="ui-stack--xs">
            {reports.length === 0 ? (
              <EmptyState
                compact
                icon="file-spreadsheet"
                title="Chưa có tờ khai nội bộ"
                description="Chọn kỳ quý phía trên và bấm Sinh / cập nhật."
              />
            ) : (
              reports.slice(0, 4).map((r) => (
                <div className="ops-report-row" key={r.id}>
                  <div className="ops-action-main">
                    <strong>{r.ky}</strong>
                    <small>
                      v{r.version} · {r.snapshot.so_hd_ban ?? 0} bán /{" "}
                      {r.snapshot.so_hd_mua ?? 0} mua
                    </small>
                  </div>
                  <StatusBadge
                    tone={r.status === "locked" ? "success" : "warning"}
                    size="sm"
                  >
                    {r.status === "locked" ? "Đã khóa" : "Bản nháp"}
                  </StatusBadge>
                  <a
                    className="ui-btn ui-btn--secondary ui-btn--sm"
                    href={api.taxReportFileUrl(r.id)}
                  >
                    <AppIcon name="download" size={14} />
                    <span>Tải XLSX</span>
                  </a>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </section>

      <SectionCard padding="compact" tone="subtle" className="ops-sync-card">
        <div className="ui-row ui-row--md">
          <span
            className={`ops-sync-dot ops-sync-dot--${syncStatus}`}
            aria-hidden="true"
          />
          <div className="ui-grow ops-action-main">
            <strong>Lần đồng bộ gần nhất</strong>
            <small>
              {sync
                ? `${new Date(sync.started_at).toLocaleString("vi-VN")} · ${sync.period_from} — ${sync.period_to}`
                : "Chưa có lần chạy tự động"}
            </small>
          </div>
          <StatusBadge tone={syncBadgeTone} size="sm" dot>
            {sync?.status || "chưa chạy"}
          </StatusBadge>
        </div>
      </SectionCard>
    </PageShell>
  );
}
