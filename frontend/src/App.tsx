import { useEffect, useState } from "react";
import { api } from "./api";
import { Login } from "./pages/Login";
import { Signer } from "./pages/Signer";
import { Verify } from "./pages/Verify";

type Tab = "sign" | "verify";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("sign");
  const [agentIp, setAgentIp] = useState("192.168.1.4");
  const [warnDefault, setWarnDefault] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setAuthed(true);
        setAgentIp(m.agent_default_ip);
        setWarnDefault(m.using_default_secrets);
      })
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="center">Đang tải…</div>;
  if (!authed) return <Login onLogin={() => location.reload()} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🖊️ KSP PDF Signer</div>
        <nav>
          <button className={tab === "sign" ? "active" : ""} onClick={() => setTab("sign")}>
            Ký số
          </button>
          <button className={tab === "verify" ? "active" : ""} onClick={() => setTab("verify")}>
            Kiểm tra chữ ký
          </button>
        </nav>
        <button
          className="logout"
          onClick={async () => {
            await api.logout();
            location.reload();
          }}
        >
          Đăng xuất
        </button>
      </header>

      {warnDefault && (
        <div className="warn-banner">
          ⚠️ Đang dùng mật khẩu/khóa <b>mặc định</b>. Hãy đổi trong file <code>.env</code> trước khi
          chạy thật.
        </div>
      )}

      <main>{tab === "sign" ? <Signer defaultIp={agentIp} /> : <Verify />}</main>
    </div>
  );
}
