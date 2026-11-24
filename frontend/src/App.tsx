import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type WebAdsDraftQuote } from "./api";
import {
  AppIcon,
  ConfirmProvider,
  MOBILE_QUERY,
  PasswordModal,
  ToastProvider,
  useToast,
  type IconName,
} from "./components/ui";
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
import { DocTracking } from "./pages/DocTracking";
import { GovRadar } from "./pages/GovRadar";
import { WebAdsLeads } from "./pages/WebAdsLeads";

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
  | "trademarks"
  | "doctracking"
  | "govradar"
  | "webads";

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
  doctracking: "/theo-doi-xem",
  govradar: "/cong-van-chinh-phu",
  webads: "/web-ads",
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
  "/ads-leads": "webads",
  "/lead-website": "webads",
};

function resolveTab(pathname: string): Tab | null {
  if (pathname.startsWith("/trademarks") || pathname.startsWith("/nhan-hieu")) return "trademarks";
  if (pathname.startsWith("/standards") || pathname.startsWith("/hop-chuan-hop-quy") || pathname.startsWith("/qcvn")) return "standards";
  if (pathname.startsWith("/bidding") || pathname.startsWith("/dau-thau")) return "bidding";
  if (pathname.startsWith("/shipping-spx") || pathname.startsWith("/spx")) return "shippingspx";
  if (pathname.startsWith("/training")) return "training";
  if (pathname.startsWith("/pymid-coop")) return "pymidcoop";
  if (pathname.startsWith("/giai-trinh-thue")) return "taxdefense";
  if (pathname.startsWith("/ads-leads") || pathname.startsWith("/web-ads") || pathname.startsWith("/lead-website")) return "webads";
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

function normSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

const TAB_ICONS: Record<Tab, IconName> = {
  home: "layout-dashboard",
  pymidcoop: "layers",
  training: "sparkles",
  webads: "trending-up",
  messenger: "message-square",
  telegram: "send",
  bidding: "landmark",
  standards: "shield-check",
  thuesync: "refresh",
  thuebct: "file-spreadsheet",
  taxdefense: "scale",
  govradar: "radio",
  nhaphang: "download",
  banra: "upload",
  hoadonnhap: "file-plus",
  tonkho: "warehouse",
  tokhai: "clipboard-list",
  xuatkho: "package",
  congthuc: "sliders",
  sanxuat: "factory",
  settings: "settings",
  shippingspx: "truck",
  sign: "file-signature",
  verify: "file-search",
  doctracking: "eye",
  customers: "users",
  nas: "hard-drive",
  payroll: "wallet",
  quote: "receipt",
  trademarks: "award",
  documents: "folder",
  mine: "folder-open",
  bbbg: "file-check",
  contract: "file-text",
  khoan: "briefcase",
  audit: "activity",
};

/** Uniform Lucide SVG navigation icons matching INUT Design System v2 stroke discipline. */
function NavIcon({ tab }: { tab: Tab }) {
  return <AppIcon name={TAB_ICONS[tab]} size={16} strokeWidth={1.9} />;
}

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_QUERY).matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

function AppShell() {
  const { showToast } = useToast();
  const isMobile = useIsMobileViewport();
  const [me, setMe] = useState<Me | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTabState] = useState<Tab>("home");
  const [verifyDocPk, setVerifyDocPk] = useState<number | null>(null);
  const [openPurchaseId, setOpenPurchaseId] = useState<number | null>(null);
  const [highlightDocPk, setHighlightDocPk] = useState<number | null>(null);
  const [quotePrefill, setQuotePrefill] = useState<WebAdsDraftQuote | null>(null);
  const [fromLeadId, setFromLeadId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navFilter, setNavFilter] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [preSign, setPreSign] = useState<
    {
      docId: string;
      filename: string;
      docType: string;
      customerId: number | null;
      orderId?: number | null;
      existingDocumentId?: number | null;
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

  // Lock body scroll and support Escape key while mobile drawer is open (UI-MOB-07)
  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow || "";
    };
  }, [menuOpen]);

  // Ctrl/Cmd/Shift+click (hoặc click giữa) trên menu -> để trình duyệt tự mở tab/cửa
  // sổ mới theo href thật (không preventDefault); click thường mới điều hướng kiểu SPA.
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

  async function handlePasswordSubmit(oldp: string, newp: string) {
    await api.changeMyPassword(oldp, newp);
    // Re-fetch /api/me so forced must_change_password unlocks seamlessly if session stays active,
    // or reload to login if server revoked the current session cookie.
    try {
      const fresh = await api.me();
      setMe(fresh as Me);
      setPasswordModalOpen(false);
      showToast("Đã đổi mật khẩu thành công. Các phiên đăng nhập cũ đã được thu hồi.", "success");
    } catch {
      setPasswordModalOpen(false);
      showToast("Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.", "info");
      location.reload();
    }
  }

  async function handleLogout() {
    await api.logout();
    location.reload();
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
              "pymidcoop", "shippingspx", "bidding", "standards", "taxdefense", "trademarks", "doctracking", "govradar", "webads",
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
        const initial =
          fromPath && allowed.includes(fromPath)
            ? fromPath
            : isAdmin
              ? "home"
              : isPymidStaff
                ? "pymidcoop"
                : "mine";

        const isSubpathHandled =
          window.location.pathname.startsWith("/trademarks") ||
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
          const leadPk = initial === "quote" ? Number(routeParams.get("fromLead")) : 0;
          if (leadPk > 0) setFromLeadId(leadPk);
          const initialSearch =
            verifyPk > 0
              ? `?doc=${verifyPk}`
              : initial === "nhaphang" && hdPk > 0
                ? `?hd=${hdPk}`
                : initial === "quote" && leadPk > 0
                  ? `?fromLead=${leadPk}`
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
        } else if (t === "quote") {
          const leadPk = Number(sp.get("fromLead"));
          setFromLeadId(leadPk > 0 ? leadPk : null);
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigate]);

  const isAdmin = me?.role === "admin";
  const isPymidStaff = me?.portal_scope === "pymid_coop";
  const isPymid = me?.customer_name?.toLocaleLowerCase("vi").includes("pymid") ?? false;

  // Menu gom nhóm, hiển thị ở sidebar trái
  const groups = useMemo<[string, [Tab, string][]][]>(() => {
    if (!me) return [];
    const adminGroups: [string, [Tab, string][]][] = [
      ["Tổng quan", [["home", "Trung tâm vận hành"]]],
      ["Hợp tác", [["pymidcoop", "INUT – PYMID CO.OP"]]],
      ["Trợ lý", [["training", "iNut Training"]]],
      [
        "Kênh bán hàng & Đấu thầu",
        [
          ["webads", "Ads & Lead Website"],
          ["messenger", "Messenger fanpage"],
          ["bidding", "Đấu Thầu (Mua Sắm Công)"],
          ["standards", "Hợp Chuẩn & Hợp Quy (QCVN)"],
        ],
      ],
      ["Thông báo", [["telegram", "Telegram thông báo"]]],
      [
        "Hóa đơn & Thuế",
        [
          ["thuesync", "Đồng bộ thuế"],
          ["thuebct", "Review tờ khai"],
          ["taxdefense", "Giải trình thuế (2022-2025)"],
          ["govradar", "Radar Công văn & Thuế CS7"],
          ["nhaphang", "Hóa đơn mua"],
          ["banra", "Hóa đơn bán"],
          ["hoadonnhap", "Tạo HĐ nháp"],
        ],
      ],
      [
        "Kho & Sản xuất",
        [
          ["tonkho", "Tồn kho"],
          ["tokhai", "Tờ khai nhập khẩu"],
          ["xuatkho", "Xuất kho"],
          ["sanxuat", "Sản xuất"],
          ["congthuc", "Công thức"],
          ["shippingspx", "Vận đơn SPX"],
        ],
      ],
      [
        "Hồ sơ",
        [
          ["sign", "Ký số"],
          ["bbbg", "Tạo BBBG"],
          ["quote", "Báo giá"],
          ["contract", "Soạn hợp đồng"],
          ["trademarks", "Nhãn hiệu (Sở hữu trí tuệ)"],
          ["documents", "Kho hồ sơ"],
          ["doctracking", "Theo dõi lượt xem"],
          ["verify", "Kiểm tra chữ ký"],
        ],
      ],
      [
        "Quản lý",
        [
          ["payroll", "Bảng lương"],
          ["customers", "Khách hàng"],
          ["nas", "NAS"],
          ["khoan", "HĐ Khoán & CTV"],
          ["audit", "Nhật ký"],
          ["settings", "Cài đặt"],
        ],
      ],
    ];
    const custGroups: [string, [Tab, string][]][] = [
      [
        "Hồ sơ",
        [
          ["mine", "Hồ sơ của tôi"],
          ["verify", "Kiểm tra chữ ký"],
        ],
      ],
    ];
    const result: [string, [Tab, string][]][] = isAdmin
      ? adminGroups
      : isPymidStaff
        ? []
        : [...custGroups];
    if (!isAdmin && me.training_access) {
      result.unshift(["Trợ lý", [["training", "iNut Training"]]]);
    }
    if (!isAdmin && isPymid) {
      result.unshift(["Hợp tác", [["pymidcoop", "INUT – PYMID CO.OP"]]]);
    }
    return result;
  }, [me, isAdmin, isPymidStaff, isPymid]);

  const activeLabel = useMemo(() => {
    for (const [, items] of groups) {
      const found = items.find(([t]) => t === tab);
      if (found) return found[1];
    }
    if (tab === "pymidcoop") return "INUT – PYMID CO.OP";
    return "KSP Suite";
  }, [groups, tab]);

  const filteredGroups = useMemo(() => {
    const q = normSearch(navFilter.trim());
    if (!q) return groups;
    return groups
      .map(([title, items]) => {
        const matchGroup = normSearch(title).includes(q);
        const kept = matchGroup
          ? items
          : items.filter(([t, label]) => normSearch(label).includes(q) || normSearch(ROUTES[t]).includes(q));
        return [title, kept] as [string, [Tab, string][]];
      })
      .filter(([, items]) => items.length > 0);
  }, [groups, navFilter]);

  if (authed === null) return <div className="center">Đang tải…</div>;
  if (!authed || !me) return <Login onLogin={() => location.reload()} />;

  const forcedPasswordChange = Boolean(me.must_change_password);

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="hamburger"
          aria-label="Mở menu điều hướng"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <AppIcon name="menu" size={20} strokeWidth={2.2} />
        </button>
        <div className="brand">
          <span className="mark" aria-hidden="true">K</span>
          <span className="brand-copy">
            <strong>KSP</strong>
            <small>Operations Suite</small>
          </span>
        </div>
        <span className="topbar-route-pill" title={activeLabel}>
          {activeLabel}
        </span>
        {!isMobile && (
          <div className="topbar-user">
            <span className="who">
              {me.username}
              {me.customer_name ? ` · ${me.customer_name}` : isAdmin ? " · Quản trị" : ""}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => setPasswordModalOpen(true)}
            >
              Đổi mật khẩu
            </button>
            <button
              type="button"
              className="logout"
              onClick={handleLogout}
            >
              Đăng xuất
            </button>
          </div>
        )}
      </header>

      <div className="body-row">
        {menuOpen && (
          <div
            className="sidebar-backdrop"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <aside className={"sidebar" + (menuOpen ? " open" : "")} aria-label="Điều hướng chức năng">
          <div className="sidebar-head">
            <div className="sidebar-head-brand brand">
              <span className="mark" aria-hidden="true">K</span>
              <span>KSP Suite</span>
            </div>
            <button
              type="button"
              className="sidebar-close"
              aria-label="Đóng menu"
              onClick={() => setMenuOpen(false)}
            >
              <AppIcon name="x" size={18} strokeWidth={2.2} />
            </button>
          </div>

          {groups.length > 2 && (
            <div className="sidebar-search-wrap">
              <input
                type="search"
                className="sidebar-search"
                aria-label="Tìm nhanh chức năng"
                placeholder="Tìm nhanh mục menu…"
                value={navFilter}
                onChange={(e) => setNavFilter(e.target.value)}
              />
            </div>
          )}

          <div className="sidebar-scroll">
            {filteredGroups.map(([title, items]) => {
              const hasActive = items.some(([t]) => t === tab);
              const isCollapsed = !navFilter.trim() && !hasActive && Boolean(collapsedGroups[title]);
              return (
                <div className="nav-group" key={title}>
                  <button
                    type="button"
                    className="nav-group-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsedGroups((prev) => ({ ...prev, [title]: !isCollapsed }))
                    }
                  >
                    <span>{title}</span>
                    <AppIcon
                      name="chevron-down"
                      size={13}
                      strokeWidth={2.4}
                      className={`nav-group-caret${isCollapsed ? " collapsed" : ""}`}
                    />
                  </button>
                  {!isCollapsed &&
                    items.map(([t, label]) => (
                      <a
                        key={t}
                        href={ROUTES[t]}
                        className={tab === t ? "active" : ""}
                        onClick={(e) => navClick(e, t)}
                      >
                        <span className="nav-ic">
                          <NavIcon tab={t} />
                        </span>
                        <span>{label}</span>
                      </a>
                    ))}
                </div>
              );
            })}
            {filteredGroups.length === 0 && navFilter.trim() && (
              <div className="sidebar-empty">Không tìm thấy mục nào khớp “{navFilter}”.</div>
            )}
          </div>

          {/* Mobile Drawer Sticky Account Footer (exposes user identity + Change Password + Logout on <=820px) */}
          <div className="sidebar-foot">
            <div className="sidebar-user-card">
              <strong>{me.username}</strong>
              <span>{me.customer_name || (isAdmin ? "Quản trị hệ thống" : "Tài khoản khách hàng")}</span>
            </div>
            <div className="sidebar-foot-actions">
              <button
                type="button"
                className="sidebar-foot-btn"
                onClick={() => {
                  setMenuOpen(false);
                  setPasswordModalOpen(true);
                }}
              >
                Đổi mật khẩu
              </button>
              <button
                type="button"
                className="sidebar-foot-btn danger"
                onClick={handleLogout}
              >
                Đăng xuất
              </button>
            </div>
          </div>
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
              leadDraft={quotePrefill}
              fromLeadId={fromLeadId}
              onLeadDraftConsumed={() => {
                setQuotePrefill(null);
                setFromLeadId(null);
              }}
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
              onCountersign={(doc) => {
                setPreSign({
                  docId: doc.doc_id,
                  filename: doc.filename,
                  docType: doc.doc_type,
                  customerId: doc.customer_id,
                  orderId: doc.order_id,
                  existingDocumentId: doc.id,
                });
                navigate("sign");
              }}
            />
          )}
          {tab === "customers" && isAdmin && <Customers />}
          {tab === "nas" && isAdmin && <NasBrowser />}
          {tab === "audit" && isAdmin && <AuditLog />}
          {tab === "settings" && isAdmin && (
            <Settings
              usingDefaultSecrets={me.using_default_secrets}
              mustChangePassword={me.must_change_password}
              onChangePassword={() => setPasswordModalOpen(true)}
            />
          )}
          {tab === "payroll" && isAdmin && <Payroll />}
          {tab === "mine" && <MyDocuments onVerify={goVerify} />}
          {tab === "verify" && (
            <Verify docPk={verifyDocPk} onConsumed={() => setVerifyDocPk(null)} />
          )}
          {tab === "khoan" && isAdmin && <PieceworkContracts />}
          {tab === "doctracking" && isAdmin && <DocTracking />}
          {tab === "govradar" && isAdmin && <GovRadar />}
          {tab === "webads" && isAdmin && (
            <WebAdsLeads
              onCreateQuote={(draft) => {
                setQuotePrefill(draft);
                setFromLeadId(draft.lead_id);
                navigate("quote", false, `?fromLead=${draft.lead_id}`);
              }}
            />
          )}
        </main>
      </div>

      {/* 4-Slot Mobile Bottom Quick-Bar (<=820px only) */}
      {!isPymidStaff && (
        <nav className="mobile-bottom-nav" aria-label="Điều hướng nhanh mobile">
          {isAdmin ? (
            <>
              <a
                href={ROUTES.home}
                className={`mobile-bottom-nav-item${tab === "home" ? " active" : ""}`}
                onClick={(e) => navClick(e, "home")}
              >
                <NavIcon tab="home" />
                <span>Vận hành</span>
              </a>
              <a
                href={ROUTES.documents}
                className={`mobile-bottom-nav-item${tab === "documents" ? " active" : ""}`}
                onClick={(e) => navClick(e, "documents")}
              >
                <NavIcon tab="documents" />
                <span>Hồ sơ</span>
              </a>
              <a
                href={ROUTES.sign}
                className={`mobile-bottom-nav-item${tab === "sign" ? " active" : ""}`}
                onClick={(e) => navClick(e, "sign")}
              >
                <NavIcon tab="sign" />
                <span>Ký số</span>
              </a>
              <button
                type="button"
                className={`mobile-bottom-nav-item${menuOpen ? " active" : ""}`}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <AppIcon name="menu" size={16} strokeWidth={2.1} />
                <span>Menu</span>
              </button>
            </>
          ) : (
            <>
              <a
                href={ROUTES.mine}
                className={`mobile-bottom-nav-item${tab === "mine" ? " active" : ""}`}
                onClick={(e) => navClick(e, "mine")}
              >
                <NavIcon tab="mine" />
                <span>Hồ sơ</span>
              </a>
              <a
                href={ROUTES.verify}
                className={`mobile-bottom-nav-item${tab === "verify" ? " active" : ""}`}
                onClick={(e) => navClick(e, "verify")}
              >
                <NavIcon tab="verify" />
                <span>Kiểm tra</span>
              </a>
              {me.training_access && (
                <a
                  href={ROUTES.training}
                  className={`mobile-bottom-nav-item${tab === "training" ? " active" : ""}`}
                  onClick={(e) => navClick(e, "training")}
                >
                  <NavIcon tab="training" />
                  <span>Training</span>
                </a>
              )}
              <button
                type="button"
                className={`mobile-bottom-nav-item${menuOpen ? " active" : ""}`}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <NavIcon tab="customers" />
                <span>Tài khoản</span>
              </button>
            </>
          )}
        </nav>
      )}

      {!isAdmin && (
        <footer className="thanks-bar">
          <span className="thanks-heart" aria-hidden="true">
            <AppIcon name="heart" size={15} />
          </span>
          <span>
            Cảm ơn Quý khách đã tin tưởng sử dụng dịch vụ của{" "}
            <a href="https://inut.vn" target="_blank" rel="noreferrer">
              INUT
            </a>
          </span>
        </footer>
      )}

      {/* Masked Password Change Modal — automatically forced when must_change_password === true (Conflict Guard #4) */}
      <PasswordModal
        open={passwordModalOpen || forcedPasswordChange}
        forced={forcedPasswordChange}
        onClose={() => setPasswordModalOpen(false)}
        onSubmit={handlePasswordSubmit}
      />
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell />
      </ConfirmProvider>
    </ToastProvider>
  );
}
