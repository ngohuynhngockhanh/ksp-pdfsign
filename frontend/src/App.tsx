import { useEffect, useState } from "react";
import { api } from "./api";
import { Login } from "./pages/Login";
import { Signer } from "./pages/Signer";
import { Verify } from "./pages/Verify";
import { Customers } from "./pages/Customers";
import { Documents } from "./pages/Documents";
import { MyDocuments } from "./pages/MyDocuments";
import { NasBrowser } from "./pages/NasBrowser";
import { CreateBBBG } from "./pages/CreateBBBG";
import { CreateQuote } from "./pages/CreateQuote";
import { AuditLog } from "./pages/AuditLog";
import { Inventory } from "./pages/Inventory";
import { PurchaseImport } from "./pages/PurchaseImport";
import { CustomsDecl } from "./pages/CustomsDecl";
import { SalesInvoice } from "./pages/SalesInvoice";
import { StockIssue } from "./pages/StockIssue";
import { Production } from "./pages/Production";
import { Recipes } from "./pages/Recipes";
import { SaleDraft } from "./pages/SaleDraft";
import { Settings } from "./pages/Settings";
import { TaxSync } from "./pages/TaxSync";
import { TaxReview } from "./pages/TaxReview";
import { Operations } from "./pages/Operations";

type Tab =
  | "home"
  | "sign"
  | "bbbg"
  | "quote"
  | "tonkho"
  | "nhaphang"
  | "tokhai"
  | "banra"
  | "xuatkho"
  | "sanxuat"
  | "congthuc"
  | "hoadonnhap"
  | "thuesync"
  | "thuebct"
  | "documents"
  | "customers"
  | "nas"
  | "audit"
  | "settings"
  | "verify"
  | "mine";

const ROUTES: Record<Tab, string> = {
  home: "/",
  sign: "/ky-so",
  bbbg: "/tao-bbbg",
  quote: "/bao-gia",
  tonkho: "/ton-kho",
  nhaphang: "/nhap-hang",
  tokhai: "/to-khai-nk",
  banra: "/ban-ra",
  xuatkho: "/xuat-kho",
  sanxuat: "/san-xuat",
  congthuc: "/cong-thuc",
  hoadonnhap: "/tao-hoa-don-nhap",
  thuesync: "/dong-bo-thue",
  thuebct: "/review-to-khai",
  documents: "/ho-so",
  customers: "/khach-hang",
  nas: "/nas",
  audit: "/nhat-ky",
  settings: "/cai-dat",
  verify: "/kiem-tra",
  mine: "/ho-so-cua-toi",
};
const PATH_TO_TAB: Record<string, Tab> = Object.fromEntries(
  Object.entries(ROUTES).map(([t, p]) => [p, t as Tab]),
) as Record<string, Tab>;

interface Me {
  username: string;
  role: string;
  customer_name: string | null;
  agent_default_ip: string;
  default_location: string;
  using_default_secrets: boolean;
  must_change_password: boolean;
}

async function changePassword() {
  const oldp = window.prompt("Mật khẩu hiện tại:");
  if (!oldp) return;
  const newp = window.prompt("Mật khẩu mới:");
  if (!newp) return;
  try {
    await api.changeMyPassword(oldp, newp);
    window.alert("Đã đổi mật khẩu. Các phiên cũ đã được thu hồi; vui lòng đăng nhập lại.");
    location.reload();
  } catch (e) {
    window.alert((e as Error).message);
  }
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTabState] = useState<Tab>("home");
  const [verifyDocPk, setVerifyDocPk] = useState<number | null>(null);
  const [openPurchaseId, setOpenPurchaseId] = useState<number | null>(null);
  const [highlightDocPk, setHighlightDocPk] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preSign, setPreSign] = useState<
    {
      docId: string;
      filename: string;
      docType: string;
      customerId: number | null;
      orderId?: number | null;
    } | null
  >(null);

  function navigate(t: Tab, replace = false) {
    const path = ROUTES[t];
    if (replace) history.replaceState({ t }, "", path);
    else history.pushState({ t }, "", path);
    setTabState(t);
  }

  // Ctrl/Cmd/Shift+click (hoac click giua) tren menu -> de trinh duyet tu mo tab/cua
  // so moi theo href that (khong preventDefault); click thuong moi dieu huong kieu SPA.
  function navClick(e: React.MouseEvent, t: Tab) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    navigate(t);
    setMenuOpen(false);
  }

  function goVerify(docPk: number) {
    setVerifyDocPk(docPk);
    navigate("verify");
  }

  function goPurchase(purchaseId: number) {
    setOpenPurchaseId(purchaseId);
    navigate("nhaphang");
  }

  function goDocuments(docPk: number) {
    setHighlightDocPk(docPk);
    navigate("documents");
  }

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m as Me);
        setAuthed(true);
        const isAdmin = m.role === "admin";
        const allowed = isAdmin
          ? ([
              "home", "sign", "bbbg", "quote", "tonkho", "nhaphang", "thuesync", "thuebct", "tokhai", "banra", "hoadonnhap", "xuatkho", "sanxuat", "congthuc",
              "documents", "customers", "nas", "audit", "settings", "verify",
            ] as Tab[])
          : (["mine", "verify"] as Tab[]);
        const fromPath = PATH_TO_TAB[window.location.pathname];
        const initial = fromPath && allowed.includes(fromPath)
          ? fromPath
          : isAdmin
            ? "home"
            : "mine";
        navigate(initial, true);
      })
      .catch(() => setAuthed(false));
    const onPop = () => {
      const t = PATH_TO_TAB[window.location.pathname];
      if (t) setTabState(t);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (authed === null) return <div className="center">Đang tải…</div>;
  if (!authed || !me) return <Login onLogin={() => location.reload()} />;

  const isAdmin = me.role === "admin";
  // Menu gom nhom, hien o sidebar trai
  const adminGroups: [string, [Tab, string, string][]][] = [
    ["Tổng quan", [["home", "Trung tâm vận hành", "◉"]]],
    [
      "Hóa đơn & Thuế",
      [
        ["thuesync", "Đồng bộ thuế", "↻"],
        ["thuebct", "Review tờ khai", "▤"],
        ["nhaphang", "Hóa đơn mua", "↓"],
        ["banra", "Hóa đơn bán", "↑"],
        ["hoadonnhap", "Tạo HĐ nháp", "+"],
      ],
    ],
    [
      "Kho & Sản xuất",
      [
        ["tonkho", "Tồn kho", "□"], ["tokhai", "Tờ khai nhập khẩu", "◇"],
        ["xuatkho", "Xuất kho", "→"], ["sanxuat", "Sản xuất", "⚙"],
        ["congthuc", "Công thức", "⌘"],
      ],
    ],
    [
      "Hồ sơ",
      [
        ["sign", "Ký số", "✎"], ["bbbg", "Tạo BBBG", "▣"],
        ["quote", "Báo giá", "₫"], ["documents", "Kho hồ sơ", "▱"],
        ["verify", "Kiểm tra chữ ký", "⌕"],
      ],
    ],
    [
      "Quản lý",
      [
        ["customers", "Khách hàng", "👥"],
        ["nas", "NAS", "💾"],
        ["audit", "Nhật ký", "📜"],
        ["settings", "Cài đặt", "⚙️"],
      ],
    ],
  ];
  const custGroups: [string, [Tab, string, string][]][] = [
    [
      "Hồ sơ",
      [
        ["mine", "Hồ sơ của tôi", "🗂️"],
        ["verify", "Kiểm tra chữ ký", "🔎"],
      ],
    ],
  ];
  const groups = isAdmin ? adminGroups : custGroups;

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="hamburger"
          aria-label="Menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        <div className="brand">
          <span className="mark">🖊️</span> KSP PDF Signer
        </div>
        <div className="topbar-user">
          <span className="who">
            {me.username}
            {me.customer_name ? ` · ${me.customer_name}` : isAdmin ? " · Quản trị" : ""}
          </span>
          <button className="link-btn" onClick={changePassword}>
            Đổi mật khẩu
          </button>
          <button
            className="logout"
            onClick={async () => {
              await api.logout();
              location.reload();
            }}
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {isAdmin && me.using_default_secrets && (
        <div className="warn-banner">
          ⚠️ Đang dùng mật khẩu/khóa <b>mặc định</b>. Hãy đổi trong file <code>.env</code> trước khi
          chạy thật.
        </div>
      )}
      {me.must_change_password && (
        <div className="warn-banner security-action">
          Tài khoản đang dùng mật khẩu tạm. <button className="link-btn" onClick={changePassword}>Đổi mật khẩu ngay</button>
        </div>
      )}

      <div className="body-row">
        {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
        <aside className={"sidebar" + (menuOpen ? " open" : "")}>
          {groups.map(([title, items]) => (
            <div className="nav-group" key={title}>
              <div className="nav-title">{title}</div>
              {items.map(([t, label, icon]) => (
                <a
                  key={t}
                  href={ROUTES[t]}
                  className={tab === t ? "active" : ""}
                  onClick={(e) => navClick(e, t)}
                >
                  <span className="nav-ic">{icon}</span> {label}
                </a>
              ))}
            </div>
          ))}
        </aside>

        <main>
        {tab === "home" && isAdmin && <Operations navigate={(t) => navigate(t as Tab)} />}
        {tab === "sign" && isAdmin && (
          <Signer
            defaultIp={me.agent_default_ip}
            defaultLocation={me.default_location}
            preSign={preSign}
            onOpenDocument={goDocuments}
          />
        )}
        {tab === "bbbg" && isAdmin && (
          <CreateBBBG
            onGenerated={(docId, filename, customerId) => {
              setPreSign({ docId, filename, docType: "bbbg", customerId });
              navigate("sign");
            }}
          />
        )}
        {tab === "quote" && isAdmin && (
          <CreateQuote
            onGenerated={(docId, filename, docType, customerId, orderId) => {
              setPreSign({ docId, filename, docType, customerId, orderId });
              navigate("sign");
            }}
          />
        )}
        {tab === "tonkho" && isAdmin && <Inventory onOpenPurchase={goPurchase} />}
        {tab === "nhaphang" && isAdmin && (
          <PurchaseImport openId={openPurchaseId} onConsumed={() => setOpenPurchaseId(null)} />
        )}
        {tab === "tokhai" && isAdmin && <CustomsDecl />}
        {tab === "banra" && isAdmin && <SalesInvoice />}
        {tab === "xuatkho" && isAdmin && <StockIssue />}
        {tab === "sanxuat" && isAdmin && <Production />}
        {tab === "congthuc" && isAdmin && <Recipes />}
        {tab === "hoadonnhap" && isAdmin && <SaleDraft />}
        {tab === "thuesync" && isAdmin && <TaxSync />}
        {tab === "thuebct" && isAdmin && <TaxReview />}
        {tab === "documents" && isAdmin && (
          <Documents
            onVerify={goVerify}
            highlightId={highlightDocPk}
            onConsumed={() => setHighlightDocPk(null)}
          />
        )}
        {tab === "customers" && isAdmin && <Customers />}
        {tab === "nas" && isAdmin && <NasBrowser />}
        {tab === "audit" && isAdmin && <AuditLog />}
        {tab === "settings" && isAdmin && <Settings />}
        {tab === "mine" && <MyDocuments onVerify={goVerify} />}
        {tab === "verify" && (
          <Verify docPk={verifyDocPk} onConsumed={() => setVerifyDocPk(null)} />
        )}
        </main>
      </div>

      {!isAdmin && (
        <footer className="thanks-bar">
          💙 Cảm ơn Quý khách đã tin tưởng sử dụng dịch vụ của{" "}
          <a href="https://inut.vn" target="_blank" rel="noreferrer">
            INUT
          </a>
        </footer>
      )}
    </div>
  );
}
