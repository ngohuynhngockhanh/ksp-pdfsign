import { useEffect, useState } from "react";
import { api } from "./api";
import { Login } from "./pages/Login";
import { Signer } from "./pages/Signer";
import { Verify } from "./pages/Verify";
import { Customers } from "./pages/Customers";
import { Documents } from "./pages/Documents";
import { MyDocuments } from "./pages/MyDocuments";

type Tab = "sign" | "documents" | "customers" | "verify" | "mine";

interface Me {
  username: string;
  role: string;
  customer_name: string | null;
  agent_default_ip: string;
  using_default_secrets: boolean;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("sign");

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m as Me);
        setAuthed(true);
        setTab(m.role === "admin" ? "sign" : "mine");
      })
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="center">Đang tải…</div>;
  if (!authed || !me) return <Login onLogin={() => location.reload()} />;

  const isAdmin = me.role === "admin";
  const adminTabs: [Tab, string][] = [
    ["sign", "Ký số"],
    ["documents", "Hồ sơ"],
    ["customers", "Khách hàng"],
    ["verify", "Kiểm tra chữ ký"],
  ];
  const custTabs: [Tab, string][] = [
    ["mine", "Hồ sơ của tôi"],
    ["verify", "Kiểm tra chữ ký"],
  ];
  const tabs = isAdmin ? adminTabs : custTabs;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🖊️ KSP PDF Signer</div>
        <nav>
          {tabs.map(([t, label]) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="who">
          {me.username}
          {me.customer_name ? ` · ${me.customer_name}` : isAdmin ? " · Quản trị" : ""}
        </div>
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

      {isAdmin && me.using_default_secrets && (
        <div className="warn-banner">
          ⚠️ Đang dùng mật khẩu/khóa <b>mặc định</b>. Hãy đổi trong file <code>.env</code> trước khi
          chạy thật.
        </div>
      )}

      <main>
        {tab === "sign" && isAdmin && <Signer defaultIp={me.agent_default_ip} />}
        {tab === "documents" && isAdmin && <Documents />}
        {tab === "customers" && isAdmin && <Customers />}
        {tab === "mine" && <MyDocuments />}
        {tab === "verify" && <Verify />}
      </main>
    </div>
  );
}
