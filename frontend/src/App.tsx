import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type WebAdsDraftQuote } from "./api";
import { PasswordModal, ToastProvider, useToast } from "./components/ui";
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

/** Uniform 18x18 stroke SVG icons replacing mixed emoji/Unicode sidebar glyphs (UI-MOB-19). */
function NavIcon({ tab }: { tab: Tab }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (tab) {
    case "home":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "pymidcoop":
      return (
        <svg {...common}>
          <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
          <path d="M12 12l8-4.5M12 12v10M12 12L4 7.5" />
        </svg>
      );
    case "training":
      return (
        <svg {...common}>
          <path d="M12 3l2.4 5.2L20 10.5l-5.6 2.3L12 18l-2.4-5.2L4 10.5l5.6-2.3L12 3z" />
        </svg>
      );
    case "webads":
      return (
        <svg {...common}>
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
      );
    case "messenger":
    case "telegram":
      return (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
        </svg>
      );
    case "bidding":
      return (
        <svg {...common}>
          <path d="M3 21h18M4 10h16M5 21V10M9 21V10M15 21V10M19 21V10M12 3l9 7H3l9-7z" />
        </svg>
      );
    case "standards":
      return (
        <svg {...common}>
          <path d="M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      );
    case "thuesync":
      return (
        <svg {...common}>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.7 4.4A9 9 0 0 0 20.5 15" />
        </svg>
      );
    case "thuebct":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      );
    case "taxdefense":
      return (
        <svg {...common}>
          <path d="M12 3v18M5 8h14M6 8l-3 6h6l-3-6zm12 0l-3 6h6l-3-6zM8 21h8" />
        </svg>
      );
    case "govradar":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2" />
          <path d="M16.2 7.8a6 6 0 0 1 0 8.5M7.8 16.2a6 6 0 0 1 0-8.5M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2" />
        </svg>
      );
    case "nhaphang":
      return (
        <svg {...common}>
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
        </svg>
      );
    case "banra":
      return (
        <svg {...common}>
          <path d="M12 15V3m0 0l-4 4m4-4l4 4M4 19h16" />
        </svg>
      );
    case "hoadonnhap":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      );
    case "tonkho":
    case "tokhai":
    case "xuatkho":
    case "congthuc":
      return (
        <svg {...common}>
          <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
          <polyline points="3.3 8 12 13 20.7 8" />
          <line x1="12" y1="22" x2="12" y2="13" />
        </svg>
      );
    case "sanxuat":
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "shippingspx":
      return (
        <svg {...common}>
          <rect x="1" y="3" width="15" height="13" rx="1.5" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      );
    case "sign":
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
    case "verify":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <polyline points="8.5 11 10.2 12.7 13.8 9.2" />
        </svg>
      );
    case "doctracking":
      return (
        <svg {...common}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "customers":
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "nas":
      return (
        <svg {...common}>
          <rect x="2" y="4" width="20" height="7" rx="2" />
          <rect x="2" y="13" width="20" height="7" rx="2" />
          <circle cx="6" cy="7.5" r="1" fill="currentColor" />
          <circle cx="6" cy="16.5" r="1" fill="currentColor" />
        </svg>
      );
    case "payroll":
    case "quote":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      );
    case "trademarks":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 16V8h4a2.5 2.5 0 0 1 0 5H9m3.5 0L15 16" />
        </svg>
      );
    case "documents":
    case "mine":
      return (
        <svg {...common}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </svg>
      );
  }
}

function AppShell() {
  const { showToast } = useToast();
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
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
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
            <div className="sidebar-head-brand">
              <span className="mark" style={{ width: 30, height: 30, fontSize: 16 }} aria-hidden="true">K</span>
              <span>KSP Suite</span>
            </div>
            <button
              type="button"
              className="sidebar-close"
              aria-label="Đóng menu"
              onClick={() => setMenuOpen(false)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
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
                    <svg
                      className={`nav-group-caret${isCollapsed ? " collapsed" : ""}`}
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
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
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
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
      <AppShell />
    </ToastProvider>
  );
}
