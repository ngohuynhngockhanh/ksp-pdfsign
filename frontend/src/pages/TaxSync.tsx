import { useEffect, useState } from "react";
import { api, TaxSyncResult } from "../api";

function vnd(n: number): string {
  return Math.round(n || 0).toLocaleString("vi-VN");
}
const thisYear = new Date().getFullYear();
const Q: Record<1 | 2 | 3 | 4, [string, string]> = {
  1: [`${thisYear}-01-01`, `${thisYear}-03-31`],
  2: [`${thisYear}-04-01`, `${thisYear}-06-30`],
  3: [`${thisYear}-07-01`, `${thisYear}-09-30`],
  4: [`${thisYear}-10-01`, `${thisYear}-12-31`],
};

export function TaxSync() {
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

  const [hasSavedPw, setHasSavedPw] = useState(false);
  async function loadCaptcha() {
    setCvalue("");
    try {
      setCap(await api.taxCaptcha());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    loadCaptcha();
    api
      .taxGetCredentials()
      .then((c) => {
        if (c.mst) setMst(c.mst);
        setHasSavedPw(c.has_password);
      })
      .catch(() => {});
  }, []);
  async function saveCreds() {
    try {
      await api.taxSaveCredentials({ mst, password });
      setHasSavedPw(true);
      setPassword("");
      window.alert("Đã lưu tài khoản (mật khẩu mã hóa). Lần sau khỏi nhập mật khẩu, chỉ cần captcha.");
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
      loadCaptcha(); // captcha dùng 1 lần
      if (r.import) {
        window.alert(
          `Đã nạp ${r.import.imported} HĐ mua vào Nhập hàng (bỏ qua ${r.import.skipped} đã có, lỗi ${r.import.errors}). Vào tab Nhập hàng để duyệt.`,
        );
      }
    } catch (e) {
      setErr((e as Error).message);
      loadCaptcha(); // captcha dùng 1 lần -> lấy mới
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="docs-page" style={{ maxWidth: 900 }}>
      <h2>Đồng bộ hóa đơn từ cơ quan thuế</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Đăng nhập cổng <b>hoadondientu.gdt.gov.vn</b> bằng tài khoản MST của công ty, tải hóa đơn
        mua/bán rồi <b>đối chiếu</b> xem hệ thống thiếu hóa đơn nào. Mật khẩu không được lưu.
      </p>
      {err && <div className="error">{err}</div>}

      <div className="panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ flex: 1 }}>
            MST đăng nhập
            <input value={mst} onChange={(e) => setMst(e.target.value)} />
          </label>
          <label style={{ flex: 1 }}>
            Mật khẩu cổng thuế {hasSavedPw && <span className="chip green sm">đã lưu</span>}
            <input
              type="password"
              value={password}
              placeholder={hasSavedPw ? "•••• (để trống = dùng mật khẩu đã lưu)" : "nhập mật khẩu"}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="btn-sm ghost" style={{ alignSelf: "flex-end" }} onClick={saveCreds} title="Lưu MST + mật khẩu (mã hóa) để lần sau khỏi nhập">
            💾 Lưu tài khoản
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 6 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Mã captcha</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {cap ? (
                <span
                  style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 6, height: 44, display: "inline-flex", alignItems: "center" }}
                  dangerouslySetInnerHTML={{ __html: cap.svg }}
                />
              ) : (
                <span className="muted">đang tải…</span>
              )}
              <button className="btn-sm ghost" onClick={loadCaptcha} title="Lấy captcha khác">
                🔄
              </button>
            </div>
          </div>
          <label>
            Nhập captcha
            <input style={{ width: 120 }} value={cvalue} onChange={(e) => setCvalue(e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <div className="tb-group">
            {[1, 2, 3, 4].map((q) => (
              <button
                key={q}
                className="btn-sm ghost"
                onClick={() => {
                  setTu(Q[q as 1 | 2 | 3 | 4][0]);
                  setDen(Q[q as 1 | 2 | 3 | 4][1]);
                }}
              >
                Quý {q}
              </button>
            ))}
          </div>
          <label>
            Từ ngày
            <input type="date" value={tu} onChange={(e) => setTu(e.target.value)} />
          </label>
          <label>
            Đến ngày
            <input type="date" value={den} onChange={(e) => setDen(e.target.value)} />
          </label>
          <button
            className="btn-sm"
            disabled={busy}
            title="Dùng phiên đăng nhập đã lưu — khỏi nhập captcha (nếu còn hạn)"
            onClick={() => sync(true)}
          >
            {busy ? "⏳…" : "⚡ Đồng bộ (dùng phiên đã lưu)"}
          </button>
          <button
            className="primary"
            disabled={busy || (!password && !hasSavedPw) || !cvalue}
            onClick={() => sync(false)}
          >
            {busy ? "⏳ Đang tải…" : "🔍 Đăng nhập (captcha) & đồng bộ"}
          </button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input type="checkbox" checked={doImport} onChange={(e) => setDoImport(e.target.checked)} />
          Tự động <b>nạp hóa đơn MUA thiếu</b> vào Nhập hàng (dạng nháp chờ duyệt) — dùng chung 1 captcha
        </label>
      </div>

      {res && (
        <>
          <div className="warn-banner" style={{ marginTop: 12, display: "flex", gap: 24, flexWrap: "wrap" }}>
            {res.import && (
              <span className="chip green sm">
                ✅ Đã nạp {res.import.imported} HĐ (bỏ qua {res.import.skipped}, lỗi {res.import.errors})
              </span>
            )}
            <span>
              📥 Mua vào: cổng <b>{res.mua_cong}</b> / hệ thống <b>{res.mua_he_thong}</b> →{" "}
              <b className={res.missing_mua.length ? "chip red sm" : "chip green sm"}>
                thiếu {res.missing_mua.length}
              </b>
            </span>
            <span>
              📤 Bán ra: cổng <b>{res.ban_cong}</b> / hệ thống <b>{res.ban_he_thong}</b> →{" "}
              <b className={res.missing_ban.length ? "chip red sm" : "chip green sm"}>
                thiếu {res.missing_ban.length}
              </b>
            </span>
          </div>

          {((res.orphan_mua && res.orphan_mua.length > 0) ||
            (res.orphan_ban && res.orphan_ban.length > 0)) && (
            <>
              <h3>🚨 Hóa đơn trong hệ thống KHÔNG có trên cơ quan thuế (nghi lỗi parse/nhập sai)</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Cơ quan thuế là chuẩn. Các HĐ dưới đây có trong hệ thống nhưng không khớp cổng thuế —
                kiểm tra lại số HĐ/MST (nhiều khi do parse PDF sai) hoặc là HĐ trùng/nhập nhầm.
              </p>
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Loại</th>
                      <th>Ngày</th>
                      <th>Số HĐ</th>
                      <th>Đối tác</th>
                      <th style={{ textAlign: "right" }}>Tiền</th>
                      <th>Nguồn/TT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(res.orphan_mua ?? []).map((h, i) => (
                      <tr key={`m${i}`} className="row-neg">
                        <td>MUA</td>
                        <td>{h.ngay}</td>
                        <td>{h.so_hd}</td>
                        <td>{h.ten_ban} <span className="muted">({h.mst_ban})</span></td>
                        <td style={{ textAlign: "right" }}>{vnd(h.tong_tien)}</td>
                        <td className="muted">{h.source}/{h.status}</td>
                      </tr>
                    ))}
                    {(res.orphan_ban ?? []).map((h, i) => (
                      <tr key={`b${i}`} className="row-neg">
                        <td>BÁN</td>
                        <td>{h.ngay}</td>
                        <td>{h.ky_hieu} {h.so_hd}</td>
                        <td>{h.ten_mua}</td>
                        <td style={{ textAlign: "right" }}>{vnd(h.tong_tien)}</td>
                        <td className="muted">{h.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {res.mismatch_mua && res.mismatch_mua.length > 0 && (
            <>
              <h3>⚠️ Hóa đơn LỆCH TIỀN so với cơ quan thuế (cần sửa)</h3>
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Số HĐ</th>
                      <th>Nhà cung cấp</th>
                      <th style={{ textAlign: "right" }}>Hệ thống</th>
                      <th style={{ textAlign: "right" }}>Cổng thuế (đúng)</th>
                      <th style={{ textAlign: "right" }}>Lệch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.mismatch_mua.map((h, i) => (
                      <tr key={i} className="row-neg">
                        <td>{h.ngay}</td>
                        <td>{h.ky_hieu} {h.so_hd}</td>
                        <td>{h.ten_ban}</td>
                        <td style={{ textAlign: "right" }}>{vnd(h.tien_he_thong)}</td>
                        <td style={{ textAlign: "right" }}>
                          <b>{vnd(h.tien_cong_thue)}</b>
                        </td>
                        <td style={{ textAlign: "right", color: "#c0392b", fontWeight: 600 }}>
                          {h.lech > 0 ? "+" : ""}
                          {vnd(h.lech)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {res.missing_mua.length > 0 && (
            <>
              <h3>Hóa đơn MUA VÀO thiếu (có trên cổng thuế, chưa nạp)</h3>
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Số HĐ</th>
                      <th>Nhà cung cấp</th>
                      <th>MST</th>
                      <th style={{ textAlign: "right" }}>Tổng tiền</th>
                      <th>Loại</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.missing_mua.map((h, i) => (
                      <tr key={i} className="row-treo">
                        <td>{h.ngay}</td>
                        <td>{h.ky_hieu} {h.so_hd}</td>
                        <td>{h.ten_ban}</td>
                        <td className="muted">{h.mst_ban}</td>
                        <td style={{ textAlign: "right" }}>{vnd(h.tong_tien)}</td>
                        <td>
                          <span className="chip gray sm">{h.co_ma ? "có mã" : "không mã"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {res.missing_ban.length > 0 && (
            <>
              <h3>Hóa đơn BÁN RA thiếu</h3>
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Số HĐ</th>
                      <th>Khách mua</th>
                      <th style={{ textAlign: "right" }}>Tổng tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.missing_ban.map((h, i) => (
                      <tr key={i} className="row-treo">
                        <td>{h.ngay}</td>
                        <td>{h.ky_hieu} {h.so_hd}</td>
                        <td>{h.ten_mua}</td>
                        <td style={{ textAlign: "right" }}>{vnd(h.tong_tien)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {res.missing_mua.length === 0 && res.missing_ban.length === 0 && (
            <div className="warn-banner" style={{ marginTop: 10 }}>
              ✅ Không thiếu hóa đơn nào — hệ thống đã khớp đủ với cổng thuế trong khoảng này.
            </div>
          )}
        </>
      )}
    </div>
  );
}
