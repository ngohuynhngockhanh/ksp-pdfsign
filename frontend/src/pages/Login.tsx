import { useState } from "react";
import { api } from "../api";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.login(username, password);
      onLogin();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <span className="login-kicker">INUT · SECURE WORKSPACE</span>
        <h1>KSP Operations Suite</h1>
        <p className="muted">Đăng nhập để ký số và kiểm tra chữ ký PDF</p>
        <label>
          Tài khoản
          <input
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {err && <div className="error" role="alert">{err}</div>}
        <button type="submit" disabled={busy}>
          {busy ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
        <p className="thanks-note">
          <span className="thanks-heart" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </span>
          <span>
            Cảm ơn Quý khách đã tin tưởng sử dụng dịch vụ của{" "}
            <a href="https://inut.vn" target="_blank" rel="noreferrer">
              INUT
            </a>
          </span>
        </p>
      </form>
    </div>
  );
}
