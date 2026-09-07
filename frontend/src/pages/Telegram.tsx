import { useEffect, useState } from "react";
import { api } from "../api";

type TelegramStatus = Awaited<ReturnType<typeof api.telegramStatus>>;

export function Telegram() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setErr("");
    try {
      setStatus(await api.telegramStatus());
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  useEffect(() => { load(); }, []);

  async function connect() {
    setBusy(true); setErr(""); setNotice("");
    try {
      const result = await api.telegramConnect();
      setLink(result.url);
      setExpiresAt(result.expires_at);
      setNotice("Đã tạo link một lần. Mở link bằng Telegram rồi bấm Start.");
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Ngắt Telegram khỏi tài khoản KSP này?")) return;
    setBusy(true); setErr("");
    try {
      await api.telegramDisconnect();
      setLink("");
      setNotice("Đã ngắt kết nối Telegram.");
      await load();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setNotice("Đã sao chép link kết nối.");
  }

  if (!status) return <div className="docs-page">{err ? <div className="error">{err}</div> : "Đang tải…"}</div>;

  return (
    <div className="docs-page telegram-page" style={{ maxWidth: 820 }}>
      <header className="page-head">
        <div>
          <span className="eyebrow">NOTIFICATIONS</span>
          <h1>Telegram thông báo</h1>
          <p className="muted">Nhận tin nhắn Messenger mới của fanpage trực tiếp trong Telegram.</p>
        </div>
        <span className={`status-pill ${status.connected ? "ok" : ""}`}>{status.connected ? "Đã kết nối" : "Chưa kết nối"}</span>
      </header>

      {err && <div className="error" role="alert">{err}</div>}
      {notice && <div className="ok-note" role="status">{notice}</div>}

      {!status.enabled ? (
        <section className="panel">
          <h3>Bot chưa được bật</h3>
          <p>Quản trị viên cần đặt <code>TELEGRAM_BOT_TOKEN</code> và <code>TELEGRAM_ENABLED=true</code> trong file môi trường rồi khởi động lại backend.</p>
        </section>
      ) : status.connected ? (
        <section className="panel">
          <h3>Tài khoản Telegram đang nhận thông báo</h3>
          <p><strong>{status.display_name || status.username || "Telegram"}</strong>{status.username ? ` · @${status.username}` : ""}</p>
          <p className="muted">Tin nhắn mới sẽ kèm link mở nhanh hộp thư Messenger trong KSP.</p>
          <button className="telegram-disconnect" disabled={busy} onClick={disconnect}>Ngắt kết nối</button>
        </section>
      ) : (
        <section className="panel">
          <h3>Kết nối với @{status.bot_username}</h3>
          <p>Nhấn tạo link, mở link bằng Telegram và chọn <strong>Start</strong>. Link chỉ dùng một lần và hết hạn sau vài phút.</p>
          <button className="primary" disabled={busy} onClick={connect}>{busy ? "Đang tạo link…" : "Tạo link đăng nhập Telegram"}</button>
          {link && <div style={{ marginTop: 18 }}>
            <label>Link kết nối</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input readOnly value={link} style={{ flex: "1 1 420px" }} />
              <button onClick={copyLink}>Sao chép</button>
              <a className="telegram-open-link" href={link} target="_blank" rel="noreferrer">Mở Telegram</a>
            </div>
            {expiresAt && <small className="muted">Hết hạn: {new Date(expiresAt).toLocaleString("vi-VN")}</small>}
          </div>}
        </section>
      )}
    </div>
  );
}
