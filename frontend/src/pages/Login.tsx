import { useState, type FormEvent } from "react";
import { api } from "../api";
import { AppButton, AppIcon, FormField, InlineAlert } from "../components/ui";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
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
    <div className="ui-auth-shell">
      <form className="ui-auth-card ui-stack" onSubmit={submit}>
        <div>
          <span className="ui-auth-kicker">INUT · SECURE WORKSPACE</span>
          <h1 className="ui-auth-title">KSP Operations Suite</h1>
          <p className="ui-auth-sub">Đăng nhập để ký số và kiểm tra chữ ký PDF</p>
        </div>

        <FormField label="Tài khoản" htmlFor="login-username">
          <input
            id="login-username"
            className="ui-input"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </FormField>

        <FormField label="Mật khẩu" htmlFor="login-password">
          <input
            id="login-password"
            className="ui-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>

        {err && <InlineAlert tone="danger">{err}</InlineAlert>}

        <AppButton
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          leftIcon="log-in"
        >
          {busy ? "Đang đăng nhập…" : "Đăng nhập"}
        </AppButton>

        <p className="ui-auth-thanks">
          <AppIcon name="heart" size={14} className="ui-auth-heart" />
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
