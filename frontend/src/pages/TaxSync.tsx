import { useEffect, useState } from "react";
import { api, TaxSyncResult } from "../api";
import { EmailSyncModal } from "../components/EmailSyncModal";
import {
  AppButton,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  PageHeader,
  PageShell,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  TableSkeleton,
  useToast,
} from "../components/ui";

function vnd(n: number): string {
  return Math.round(n || 0).toLocaleString("vi-VN");
}

const thisYear = 2026;
const Q: Record<1 | 2 | 3 | 4, [string, string]> = {
  1: [`${thisYear}-01-01`, `${thisYear}-03-31`],
  2: [`${thisYear}-04-01`, `${thisYear}-06-30`],
  3: [`${thisYear}-07-01`, `${thisYear}-09-30`],
  4: [`${thisYear}-10-01`, `${thisYear}-12-31`],
};

export function TaxSync() {
  const toast = useToast();
  const [mst, setMst] = useState("4401053694");
  const [password, setPassword] = useState("");
  const [cap, setCap] = useState<{ key: string; svg: string } | null>(null);
  const [cvalue, setCvalue] = useState("");
  const [tu, setTu] = useState<string>(Q[2][0]);
  const [den, setDen] = useState<string>(Q[2][1]);
  const [busy, setBusy] = useState(false);
  const [doImport, setDoImport] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<TaxSyncResult | null>(null);
  const [emailSyncOpen, setEmailSyncOpen] = useState(false);
  const [hasSavedPw, setHasSavedPw] = useState(false);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);

  async function loadCaptcha() {
    setCvalue("");
    try {
      setCap(await api.taxCaptcha());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .taxGetCredentials()
      .then((c) => {
        if (cancelled) return;
        if (c.mst) setMst(c.mst);
        setHasSavedPw(c.has_password);
      })
      .catch(() => {});

    // Only spend a CAPTCHA when the cached tax session is no longer usable.
    api
      .taxSession()
      .then((x) => {
        if (cancelled) return;
        const valid = Boolean(x.valid);
        setSessionValid(valid);
        if (!valid) loadCaptcha();
      })
      .catch(() => {
        if (cancelled) return;
        setSessionValid(false);
        loadCaptcha();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveCreds() {
    setErr("");
    try {
      await api.taxSaveCredentials({ mst, password });
      setHasSavedPw(true);
      setPassword("");
      toast.success(
        "Đã lưu tài khoản (mật khẩu mã hóa). Lần sau khỏi nhập mật khẩu, chỉ cần captcha.",
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function sync(useSaved = false) {
    setErr("");
    setRes(null);
    setBusy(true);
    try {
      const r = await api.taxSync({
        mst,
        password,
        ckey: useSaved ? "" : cap?.key ?? "",
        cvalue: useSaved ? "" : cvalue,
        tu,
        den,
        do_import: doImport,
      });
      setRes(r);
      setSessionValid(true);
      if (r.import) {
        toast.success(
          `Đã nạp ${r.import.imported} HĐ mua vào Nhập hàng (bỏ qua ${r.import.skipped} đã có, lỗi ${r.import.errors}). Vào tab Nhập hàng để duyệt.`,
        );
      } else {
        toast.success("Đã đồng bộ và đối chiếu xong dữ liệu với cổng thuế.");
      }
    } catch (e) {
      setErr((e as Error).message);
      loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  const sessionText =
    sessionValid === null
      ? "Đang kiểm tra phiên cổng thuế…"
      : sessionValid
        ? "Phiên cổng thuế hiện còn hiệu lực"
        : "Phiên đã hết hạn — cần đăng nhập lại bằng CAPTCHA";

  return (
    <PageShell maxWidth="narrow" data-page="tax-sync">
      <div className="ui-stack--lg">
        <PageHeader
          variant="compact"
          icon="refresh"
          eyebrow="INUT · ĐỒNG BỘ CƠ QUAN THUẾ"
          title="Đồng bộ hóa đơn từ cơ quan thuế"
          subtitle={
            <>
              Đăng nhập cổng <b>hoadondientu.gdt.gov.vn</b> bằng tài khoản MST của công ty, tải hóa
              đơn mua/bán năm <b>{thisYear}</b> rồi đối chiếu. Mật khẩu đã lưu được mã hóa trên máy
              chủ.
            </>
          }
          badges={
            <StatusBadge
              tone={sessionValid === null ? "neutral" : sessionValid ? "success" : "warning"}
              dot
              className="ui-wrap"
            >
              {sessionText}
            </StatusBadge>
          }
          actions={
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="mail"
              onClick={() => setEmailSyncOpen(true)}
              title="Quét và đồng bộ hóa đơn PDF/XML từ hộp thư Zoho Mail (khanhnhn@inut.vn)"
            >
              Đồng bộ Email Zoho
            </AppButton>
          }
        />

        {err && (
          <InlineAlert tone="danger" onDismiss={() => setErr("")}>
            {err}
          </InlineAlert>
        )}

        <SectionCard
          title="Thông tin tài khoản & kỳ đối chiếu"
          subtitle="Dùng phiên đã lưu nếu còn hiệu lực, hoặc nhập CAPTCHA để mở phiên mới."
          icon="key"
        >
          <div className="ui-stack--lg">
            <FormGrid cols={3}>
              <FormField label="MST đăng nhập" htmlFor="tax-sync-mst">
                <input
                  id="tax-sync-mst"
                  className="ui-input"
                  value={mst}
                  onChange={(e) => setMst(e.target.value)}
                />
              </FormField>

              <FormField
                label={
                  <>
                    <span>Mật khẩu cổng thuế</span>
                    {hasSavedPw && (
                      <StatusBadge tone="success" size="sm">
                        đã lưu
                      </StatusBadge>
                    )}
                  </>
                }
                htmlFor="tax-sync-pw"
              >
                <input
                  id="tax-sync-pw"
                  className="ui-input"
                  type="password"
                  value={password}
                  placeholder={
                    hasSavedPw ? "•••• (để trống = dùng mật khẩu đã lưu)" : "Nhập mật khẩu"
                  }
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormField>

              <FormField label="Lưu thông tin">
                <AppButton
                  variant="secondary"
                  leftIcon="save"
                  fullWidth
                  onClick={saveCreds}
                  title="Lưu MST + mật khẩu (mã hóa) để lần sau khỏi nhập"
                >
                  Lưu tài khoản
                </AppButton>
              </FormField>
            </FormGrid>

            <div className="ui-row ui-row--md ui-row--bottom">
              <FormField label="Mã captcha">
                <div className="ui-row">
                  <span className="tp-captcha-box">
                    {cap ? (
                      <img
                        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(cap.svg)}`}
                        alt="Captcha"
                        className="tp-captcha-img"
                      />
                    ) : (
                      <SkeletonBlock variant="line" />
                    )}
                  </span>
                  <AppButton
                    variant="secondary"
                    iconOnly
                    leftIcon="refresh"
                    onClick={loadCaptcha}
                    title="Lấy captcha khác"
                    aria-label="Lấy captcha khác"
                  />
                </div>
              </FormField>

              <FormField
                label="Nhập captcha"
                htmlFor="tax-sync-captcha"
                className="tp-captcha-field"
              >
                <input
                  id="tax-sync-captcha"
                  className="ui-input"
                  value={cvalue}
                  onChange={(e) => setCvalue(e.target.value)}
                />
              </FormField>
            </div>

            <FilterBar
              collapsibleMobile={false}
              filters={
                <div className="ui-row">
                  <StatusBadge tone="neutral" size="sm">
                    Năm {thisYear}
                  </StatusBadge>
                  {([1, 2, 3, 4] as const).map((q) => (
                    <AppButton
                      key={q}
                      variant={tu === Q[q][0] && den === Q[q][1] ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => {
                        setTu(Q[q][0]);
                        setDen(Q[q][1]);
                      }}
                    >
                      Quý {q}
                    </AppButton>
                  ))}
                </div>
              }
            />

            <FormGrid cols={2}>
              <FormField label="Từ ngày" htmlFor="tax-sync-from">
                <input
                  id="tax-sync-from"
                  className="ui-input"
                  type="date"
                  value={tu}
                  onChange={(e) => setTu(e.target.value)}
                />
              </FormField>
              <FormField label="Đến ngày" htmlFor="tax-sync-to">
                <input
                  id="tax-sync-to"
                  className="ui-input"
                  type="date"
                  value={den}
                  onChange={(e) => setDen(e.target.value)}
                />
              </FormField>
            </FormGrid>

            <div className="ui-row tp-actions-wrap">
              <AppButton
                variant="secondary"
                leftIcon="zap"
                loading={busy}
                title="Dùng phiên đăng nhập đã lưu — khỏi nhập captcha (nếu còn hạn)"
                onClick={() => sync(true)}
              >
                Đồng bộ (dùng phiên đã lưu)
              </AppButton>
              <AppButton
                variant="primary"
                leftIcon="search"
                loading={busy}
                disabled={(!password && !hasSavedPw) || !cvalue}
                onClick={() => sync(false)}
              >
                Đăng nhập (captcha) &amp; đồng bộ
              </AppButton>
            </div>

            <label className="ui-check-label">
              <input
                type="checkbox"
                checked={doImport}
                onChange={(e) => setDoImport(e.target.checked)}
              />
              <span>
                Tự động <b>nạp hóa đơn MUA thiếu</b> vào Nhập hàng (dạng nháp chờ duyệt) — dùng
                chung 1 captcha
              </span>
            </label>
          </div>
        </SectionCard>

        {busy && (
          <SectionCard title="Đang đồng bộ & đối chiếu với cổng thuế…" icon="refresh">
            <TableSkeleton rows={4} cols={5} />
          </SectionCard>
        )}

        {!busy && !res && (
          <SectionCard>
            <EmptyState
              compact
              icon="cloud-download"
              title="Chưa có kết quả đối chiếu"
              description="Chọn khoảng thời gian rồi bấm Đồng bộ (dùng phiên đã lưu) hoặc Đăng nhập (captcha) & đồng bộ để so khớp hóa đơn với Tổng cục Thuế."
            />
          </SectionCard>
        )}

        {res && (
          <div className="ui-stack--lg">
            <KpiStrip
              columns={res.import ? 3 : 2}
              items={[
                {
                  label: "Hóa đơn mua vào",
                  value: `${res.mua_cong} / ${res.mua_he_thong}`,
                  sub: `Cổng thuế / Hệ thống · thiếu ${res.missing_mua.length}`,
                  icon: "cloud-download",
                  tone: res.missing_mua.length ? "danger" : "success",
                },
                {
                  label: "Hóa đơn bán ra",
                  value: `${res.ban_cong} / ${res.ban_he_thong}`,
                  sub: `Cổng thuế / Hệ thống · thiếu ${res.missing_ban.length}`,
                  icon: "cloud-upload",
                  tone: res.missing_ban.length ? "danger" : "success",
                },
                ...(res.import
                  ? [
                      {
                        label: "Đã nạp vào Nhập hàng",
                        value: `${res.import.imported} HĐ`,
                        sub: `Bỏ qua ${res.import.skipped} đã có · lỗi ${res.import.errors}`,
                        icon: "check-circle" as const,
                        tone: res.import.errors ? ("warning" as const) : ("success" as const),
                      },
                    ]
                  : []),
              ]}
            />

            {res.missing_mua.length === 0 && res.missing_ban.length === 0 && (
              <InlineAlert tone="success">
                Không thiếu hóa đơn nào — hệ thống đã khớp đủ với cổng thuế trong khoảng này.
              </InlineAlert>
            )}

            {((res.orphan_mua && res.orphan_mua.length > 0) ||
              (res.orphan_ban && res.orphan_ban.length > 0)) && (
              <SectionCard
                title="Hóa đơn trong hệ thống KHÔNG có trên cơ quan thuế"
                subtitle="Cơ quan thuế là chuẩn. Kiểm tra lại số HĐ/MST (có thể do parse PDF sai hoặc nhập trùng)."
                icon="alert-circle"
                padding="flush"
              >
                <DataView
                  mobileMode="scroll"
                  desktop={
                    <table className="dt ui-table">
                      <thead>
                        <tr>
                          <th>Loại</th>
                          <th>Ngày</th>
                          <th>Số HĐ</th>
                          <th>Đối tác</th>
                          <th className="num">Tiền</th>
                          <th>Nguồn/TT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(res.orphan_mua ?? []).map((h, i) => (
                          <tr key={`m${i}`} className="row-neg">
                            <td>
                              <StatusBadge tone="danger" size="sm">
                                MUA
                              </StatusBadge>
                            </td>
                            <td>{h.ngay}</td>
                            <td>{h.so_hd}</td>
                            <td>
                              {h.ten_ban} <span className="muted">({h.mst_ban})</span>
                            </td>
                            <td className="num">{vnd(h.tong_tien)}</td>
                            <td className="muted">
                              {h.source}/{h.status}
                            </td>
                          </tr>
                        ))}
                        {(res.orphan_ban ?? []).map((h, i) => (
                          <tr key={`b${i}`} className="row-neg">
                            <td>
                              <StatusBadge tone="danger" size="sm">
                                BÁN
                              </StatusBadge>
                            </td>
                            <td>{h.ngay}</td>
                            <td>
                              {h.ky_hieu} {h.so_hd}
                            </td>
                            <td>{h.ten_mua}</td>
                            <td className="num">{vnd(h.tong_tien)}</td>
                            <td className="muted">{h.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                />
              </SectionCard>
            )}

            {res.mismatch_mua && res.mismatch_mua.length > 0 && (
              <SectionCard
                title="Hóa đơn LỆCH TIỀN so với cơ quan thuế"
                subtitle="Cần rà soát và điều chỉnh lại theo giá trị chuẩn từ cổng thuế."
                icon="alert-triangle"
                padding="flush"
              >
                <DataView
                  mobileMode="scroll"
                  desktop={
                    <table className="dt ui-table">
                      <thead>
                        <tr>
                          <th>Ngày</th>
                          <th>Số HĐ</th>
                          <th>Nhà cung cấp</th>
                          <th className="num">Hệ thống</th>
                          <th className="num">Cổng thuế (đúng)</th>
                          <th className="num">Lệch</th>
                        </tr>
                      </thead>
                      <tbody>
                        {res.mismatch_mua.map((h, i) => (
                          <tr key={i} className="row-neg">
                            <td>{h.ngay}</td>
                            <td>
                              {h.ky_hieu} {h.so_hd}
                            </td>
                            <td>{h.ten_ban}</td>
                            <td className="num">{vnd(h.tien_he_thong)}</td>
                            <td className="num">
                              <b>{vnd(h.tien_cong_thue)}</b>
                            </td>
                            <td className="num ui-text-danger">
                              {h.lech > 0 ? "+" : ""}
                              {vnd(h.lech)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                />
              </SectionCard>
            )}

            {res.missing_mua.length > 0 && (
              <SectionCard
                title="Hóa đơn MUA VÀO thiếu (có trên cổng thuế, chưa nạp)"
                icon="file-warning"
                padding="flush"
              >
                <DataView
                  mobileMode="scroll"
                  desktop={
                    <table className="dt ui-table">
                      <thead>
                        <tr>
                          <th>Ngày</th>
                          <th>Số HĐ</th>
                          <th>Nhà cung cấp</th>
                          <th>MST</th>
                          <th className="num">Tổng tiền</th>
                          <th>Loại</th>
                        </tr>
                      </thead>
                      <tbody>
                        {res.missing_mua.map((h, i) => (
                          <tr key={i} className="row-treo">
                            <td>{h.ngay}</td>
                            <td>
                              {h.ky_hieu} {h.so_hd}
                            </td>
                            <td>{h.ten_ban}</td>
                            <td className="muted">{h.mst_ban}</td>
                            <td className="num">{vnd(h.tong_tien)}</td>
                            <td>
                              <StatusBadge tone="neutral" size="sm">
                                {h.co_ma ? "có mã" : "không mã"}
                              </StatusBadge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                />
              </SectionCard>
            )}

            {res.missing_ban.length > 0 && (
              <SectionCard title="Hóa đơn BÁN RA thiếu" icon="file-text" padding="flush">
                <DataView
                  mobileMode="scroll"
                  desktop={
                    <table className="dt ui-table">
                      <thead>
                        <tr>
                          <th>Ngày</th>
                          <th>Số HĐ</th>
                          <th>Khách mua</th>
                          <th className="num">Tổng tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {res.missing_ban.map((h, i) => (
                          <tr key={i} className="row-treo">
                            <td>{h.ngay}</td>
                            <td>
                              {h.ky_hieu} {h.so_hd}
                            </td>
                            <td>{h.ten_mua}</td>
                            <td className="num">{vnd(h.tong_tien)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                />
              </SectionCard>
            )}
          </div>
        )}

        <EmailSyncModal isOpen={emailSyncOpen} onClose={() => setEmailSyncOpen(false)} />
      </div>
    </PageShell>
  );
}
