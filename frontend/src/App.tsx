import { useCallback, useEffect, useState } from "react";
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
import { CreateContract } from "./pages/CreateContract";
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
import { Payroll } from "./pages/Payroll";
import { Training } from "./pages/Training";
import { Messenger } from "./pages/Messenger";
import { PymidCoop } from "./pages/PymidCoop";
import { Telegram } from "./pages/Telegram";
import { ShippingSPX } from "./pages/ShippingSPX";
import { BiddingProcurement } from "./pages/BiddingProcurement";
import { StandardsConformity } from "./pages/StandardsConformity";
import { TaxDefense } from "./pages/TaxDefense";
import { Trademarks } from "./pages/Trademarks";
import { PieceworkContracts } from "./pages/PieceworkContracts";


type Tab =
  | "home"
  | "sign"
  | "bbbg"
  | "quote"
  | "contract"
  | "tonkho"
  | "khoan"
  | "nhaphang"
  | "tokhai"
  | "banra"
  | "xuatkho"
  | "sanxuat"
  | "congthuc"
  | "hoadonnhap"
  | "thuesync"
  | "thuebct"
  | "taxdefense"
  | "documents"
  | "customers"
  | "nas"
  | "audit"
  | "settings"
  | "payroll"
  | "verify"
  | "mine"
  | "training"
  | "messenger"
  | "telegram"
  | "pymidcoop"
  | "shippingspx"
  | "bidding"
  | "standards"
  | "trademarks";

const ROUTES: Record<Tab, string> = {
  home: "/",
  sign: "/ky-so",
  bbbg: "/tao-bbbg",
  quote: "/bao-gia",
  contract: "/soan-hop-dong",
  khoan: "/hop-dong-khoan",
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
  taxdefense: "/giai-trinh-thue",
  documents: "/ho-so",
  customers: "/khach-hang",
  nas: "/nas",
  audit: "/nhat-ky",
  settings: "/cai-dat",
  payroll: "/bang-luong",
  verify: "/kiem-tra",
  mine: "/ho-so-cua-toi",
  training: "/training",
  messenger: "/messenger",
  telegram: "/telegram",
  pymidcoop: "/pymid-coop",
  shippingspx: "/shipping-spx",
  bidding: "/bidding",
  standards: "/standards",
  trademarks: "/trademarks",
};

const PATH_TO_TAB: Record<string, Tab> = {
  ...(Object.fromEntries(
    Object.entries(ROUTES).map(([t, p]) => [p, t as Tab]),
  ) as Record<string, Tab>),
  "/bidding": "bidding",
  "/dau-thau": "bidding",
  "/shipping-spx": "shippingspx",
  "/spx": "shippingspx",
  "/giai-trinh-thue": "taxdefense",
  "/trademarks": "trademarks",
  "/nhan-hieu": "trademarks",
};

function resolveTab(pathname: string): Tab | null {
  if (pathname.startsWith("/trademarks") || pathname.startsWith("/nhan-hieu")) return "trademarks";
  if (pathname.startsWith("/standards") || pathname.startsWith("/hop-chuan-hop-quy") || pathname.startsWith("/qcvn")) return "standards";
  if (pathname.startsWith("/bidding") || pathname.startsWith("/dau-thau")) return "bidding";
  if (pathname.startsWith("/shipping-spx") || pathname.startsWith("/spx")) return "shippingspx";
  if (pathname.startsWith("/training")) return "training";
  if (pathname.startsWith("/pymid-coop")) return "pymidcoop";
  if (pathname.startsWith("/giai-trinh-thue")) return "taxdefense";
  return PATH_TO_TAB[pathname] || null;
}

interface Me {
  username: string;
  role: string;
  portal_scope: string;
  customer_name: string | null;
  agent_default_ip: string;
  default_location: string;
  using_default_secrets: boolean;
  must_change_password: boolean;
  training_access: boolean;
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

  const navigate = useCallback((targetTab: Tab, replace = false, search = "") => {
    setTabState(targetTab);
    const path = ROUTES[targetTab] || "/";
    const full = `${path}${search}`;
    if (window.location.pathname + window.location.search !== full) {
      if (replace) {
        window.history.replaceState({ tab: targetTab }, "", full);
      } else {
        window.history.pushState({ tab: targetTab }, "", full);
      }
    }
  }, []);

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
    navigate("verify", false, `?doc=${docPk}`);
  }

  function goPurchase(purchaseId: number) {
    setOpenPurchaseId(purchaseId);
    navigate("nhaphang", false, `?hd=${purchaseId}`);
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
        const isPymidStaff = m.portal_scope === "pymid_coop";
        const allowed = isAdmin
          ? ([
              "home", "sign", "bbbg", "quote", "contract", "tonkho", "nhaphang", "thuesync", "thuebct", "tokhai", "banra", "hoadonnhap", "xuatkho", "sanxuat", "congthuc",
              "documents", "customers", "nas", "audit", "settings", "payroll", "khoan", "verify", "training", "messenger", "telegram",
              "pymidcoop", "shippingspx", "bidding", "standards", "taxdefense", "trademarks",
            ] as Tab[])
          : isPymidStaff
            ? (["pymidcoop"] as Tab[])
            : ([
              "mine",
              "verify",
              ...(m.training_access ? ["training" as Tab] : []),
              ...(m.customer_name?.toLocaleLowerCase("vi").includes("pymid") ? ["pymidcoop" as Tab] : []),
            ] as Tab[]);
        const fromPath = resolveTab(window.location.pathname);
        const initial = fromPath && allowed.includes(fromPath)
          ? fromPath
          : isAdmin
            ? "home"
            : isPymidStaff ? "pymidcoop" : "mine";

        const isSubpathHandled = window.location.pathname.startsWith("/trademarks") ||
          window.location.pathname.startsWith("/nhan-hieu") ||
          window.location.pathname.startsWith("/bidding") ||
          window.location.pathname.startsWith("/dau-thau") ||
          window.location.pathname.startsWith("/shipping-spx") ||
          window.location.pathname.startsWith("/standards");

        if (isSubpathHandled) {
          setTabState(initial);
        } else {
          const routeParams = new URLSearchParams(window.location.search);
          const verifyPk = initial === "verify" ? Number(routeParams.get("doc")) : 0;
          if (verifyPk > 0) setVerifyDocPk(verifyPk);
          const hdPk = initial === "nhaphang" ? Number(routeParams.get("hd")) : 0;
          if (hdPk > 0) setOpenPurchaseId(hdPk);
          const initialSearch = verifyPk > 0
            ? `?doc=${verifyPk}`
            : initial === "nhaphang" && hdPk > 0
              ? `?hd=${hdPk}`
              : initial === "nas" && routeParams.get("path")
                ? `?path=${encodeURIComponent(routeParams.get("path") || "")}`
                : "";
          navigate(initial, true, initialSearch);
        }
      })
      .catch(() => setAuthed(false));
    const onPop = () => {
      const t = resolveTab(window.location.pathname);
      if (t) {
        setTabState(t);
        const sp = new URLSearchParams(window.location.search);
        if (t === "verify") {
          const docPk = Number(sp.get("doc"));
          setVerifyDocPk(docPk > 0 ? docPk : null);
        } else if (t === "nhaphang") {
          const hdPk = Number(sp.get("hd"));
          if (hdPk > 0) setOpenPurchaseId(hdPk);
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigate]);

  if (authed === null) return <div className="center">Đang tải…</div>;
  if (!authed || !me) return <Login onLogin={() => location.reload()} />;

  const isAdmin = me.role === "admin";
  const isPymidStaff = me.portal_scope === "pymid_coop";
  const isPymid = me.customer_name?.toLocaleLowerCase("vi").includes("pymid") ?? false;
  // Menu gom nhom, hien o sidebar trai
  const adminGroups: [string, [Tab, string, string][]][] = [
    ["Tổng quan", [["home", "Trung tâm vận hành", "◉"]]],
    ["Hợp tác", [["pymidcoop", "INUT – PYMID CO.OP", "◆"]]],
    ["Trợ lý", [["training", "iNut Training", "✦"]]],
    [
      "Kênh bán hàng & Đấu thầu",
      [
        ["messenger", "Messenger fanpage", "◌"],
        ["bidding", "Đấu Thầu (Mua Sắm Công)", "🏛️"],
        ["standards", "Hợp Chuẩn & Hợp Quy (QCVN)", "📜"],
      ],
    ],
    ["Thông báo", [["telegram", "Telegram thông báo", "◈"]]],
    [
      "Hóa đơn & Thuế",
      [
        ["thuesync", "Đồng bộ thuế", "↻"],
        ["thuebct", "Review tờ khai", "▤"],
        ["taxdefense", "Giải trình thuế (2022-2025)", "⚖️"],
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
        ["shippingspx", "Vận đơn SPX", "🚚"],
      ],
    ],

    [
      "Hồ sơ",
      [
        ["sign", "Ký số", "✎"], ["bbbg", "Tạo BBBG", "▣"],
        ["quote", "Báo giá", "₫"], ["contract", "Soạn hợp đồng", "§"],
        ["trademarks", "Nhãn hiệu (Sở hữu trí tuệ)", "®️"],
        ["documents", "Kho hồ sơ", "▱"],
        ["verify", "Kiểm tra chữ ký", "⌕"],
      ],
    ],
    [
      "Quản lý",
      [
        ["payroll", "Bảng lương", "₫"],
        ["customers", "Khách hàng", "👥"],
        ["nas", "NAS", "💾"],
        ["khoan", "HĐ Khoán & CTV", "📋"],
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
  const groups = isAdmin ? adminGroups : isPymidStaff ? [] : custGroups;
  if (!isAdmin && me.training_access) {
    groups.unshift(["Trợ lý", [["training", "iNut Training", "✦"]]]);
  }
  if (!isAdmin && isPymid) {
    groups.unshift(["Hợp tác", [["pymidcoop", "INUT – PYMID CO.OP", "◆"]]]);
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="hamburger"
          aria-label="Menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div className="brand">
          <span className="mark" aria-hidden="true">K</span>
          <span className="brand-copy"><strong>KSP</strong><small>Operations Suite</small></span>
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

        <main className="app-content" data-page={tab}>
        {tab === "home" && isAdmin && <Operations navigate={(t) => navigate(t as Tab)} />}
        {tab === "training" && (isAdmin || me.training_access) && <Training isAdmin={isAdmin} />}
        {tab === "messenger" && isAdmin && <Messenger />}
        {tab === "telegram" && isAdmin && <Telegram />}
        {tab === "pymidcoop" && (isAdmin || isPymid) && (
          <PymidCoop isAdmin={isAdmin} canManageStaff={isAdmin || !isPymidStaff} />
        )}
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
        {tab === "contract" && isAdmin && <CreateContract />}
        {tab === "tonkho" && isAdmin && <Inventory onOpenPurchase={goPurchase} />}
        {tab === "nhaphang" && isAdmin && (
          <PurchaseImport openId={openPurchaseId} onConsumed={() => setOpenPurchaseId(null)} />
        )}
        {tab === "tokhai" && isAdmin && <CustomsDecl />}
        {tab === "banra" && isAdmin && <SalesInvoice />}
        {tab === "xuatkho" && isAdmin && <StockIssue />}
        {tab === "sanxuat" && isAdmin && <Production />}
        {tab === "congthuc" && isAdmin && <Recipes />}
        {tab === "shippingspx" && isAdmin && <ShippingSPX />}
        {tab === "bidding" && isAdmin && <BiddingProcurement />}
        {tab === "standards" && isAdmin && <StandardsConformity />}
        {tab === "trademarks" && isAdmin && <Trademarks />}
        {tab === "hoadonnhap" && isAdmin && <SaleDraft />}

        {tab === "thuesync" && isAdmin && <TaxSync />}
        {tab === "thuebct" && isAdmin && <TaxReview />}
        {tab === "taxdefense" && isAdmin && <TaxDefense />}
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
        {tab === "settings" && isAdmin && <Settings usingDefaultSecrets={me.using_default_secrets} mustChangePassword={me.must_change_password} onChangePassword={changePassword} />}
        {tab === "payroll" && isAdmin && <Payroll />}
        {tab === "mine" && <MyDocuments onVerify={goVerify} />}
        {tab === "verify" && (
          <Verify docPk={verifyDocPk} onConsumed={() => setVerifyDocPk(null)} />
        )}
        {tab === "khoan" && isAdmin && <PieceworkContracts />}
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
