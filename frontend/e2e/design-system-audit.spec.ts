import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * INUT Design System v2 — G6 Automated 36-Route × 3-Viewport Visual Audit
 *
 * Covers every G6 invariant from #90 across:
 *   - Desktop 1440×900 (run inside `desktop-1280` project via viewport resize)
 *   - Mobile iOS 390×844 (run inside `mobile-390-ios` project)
 *   - Small Android 360×800 (run inside `mobile-360` project)
 *
 * Projects `mobile-412-android` and `tablet-768` are cleanly skipped so running the
 * full 5-project Playwright suite validates all 3 required G6 viewports exactly once
 * without 5× duplication.
 */

const MINIMAL_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
    "0000000052 00000 n \n0000000101 00000 n \n" +
    "trailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n",
  "latin1",
);

const ALL_ADMIN_ROUTES = [
  "/",
  "/ky-so",
  "/tao-bbbg",
  "/bao-gia",
  "/soan-hop-dong",
  "/hop-dong-khoan",
  "/ton-kho",
  "/nhap-hang",
  "/to-khai-nk",
  "/ban-ra",
  "/xuat-kho",
  "/san-xuat",
  "/cong-thuc",
  "/tao-hoa-don-nhap",
  "/dong-bo-thue",
  "/review-to-khai",
  "/giai-trinh-thue",
  "/ho-so",
  "/khach-hang",
  "/nas",
  "/nhat-ky",
  "/cai-dat",
  "/bang-luong",
  "/kiem-tra",
  "/ho-so-cua-toi",
  "/training",
  "/messenger",
  "/telegram",
  "/pymid-coop",
  "/shipping-spx",
  "/dau-thau",
  "/standards",
  "/trademarks",
  "/theo-doi-xem",
  "/cong-van-chinh-phu",
  "/web-ads",
] as const;

type AuditViewportMode = "desktop-1440" | "mobile-390" | "mobile-360";

function resolveAuditMode(projectName: string): AuditViewportMode | null {
  if (projectName === "desktop-1280" || projectName === "desktop-1440") return "desktop-1440";
  if (projectName === "mobile-390-ios") return "mobile-390";
  if (projectName === "mobile-360" || projectName === "mobile-360-android") return "mobile-360";
  return null;
}

async function installComprehensiveMocks(
  page: Page,
  meOverride: Record<string, unknown> | (() => Record<string, unknown>) = {},
) {
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();

    if (p === "/api/me") {
      const dynamicOverride = typeof meOverride === "function" ? meOverride() : meOverride;
      return route.fulfill({
        json: {
          username: "admin",
          role: "admin",
          portal_scope: "full",
          customer_name: null,
          agent_default_ip: "127.0.0.1",
          default_location: "Đắk Lắk",
          using_default_secrets: false,
          must_change_password: false,
          training_access: true,
          ...dynamicOverride,
        },
      });
    }
    if (p === "/api/me/password" && method === "POST") {
      return route.fulfill({ json: { ok: true } });
    }
    if (p === "/api/logout") {
      return route.fulfill({ json: { ok: true } });
    }
    if (p === "/api/public/site-config") {
      return route.fulfill({
        json: {
          contact: {
            company: "CÔNG TY CP ĐẦU TƯ & PT CÔNG NGHỆ INUT",
            address: "161 Trường Chinh, Tuy Hòa",
            phone: "0901234567",
            email: "info@inut.vn",
          },
        },
      });
    }
    if (p === "/api/upload" && method === "POST") {
      return route.fulfill({ json: { doc_id: "mockdoc001", filename: "demo.pdf" } });
    }
    if (p === "/api/doc/mockdoc001" || p.endsWith("/download")) {
      return route.fulfill({ body: MINIMAL_PDF_BYTES, contentType: "application/pdf" });
    }
    if (p === "/api/certs") {
      return route.fulfill({
        json: {
          certs: [
            {
              id: "CERT-MOCK-1",
              subject: "CN=INUT TECH, MST:4401053694",
              issuer: "CN=WINCA CA",
              valid_from: "2024-01-01T00:00:00Z",
              valid_to: "2027-01-01T00:00:00Z",
              expired: false,
            },
          ],
        },
      });
    }
    if (p === "/api/operations/dashboard") {
      return route.fulfill({
        json: {
          purchases: 12,
          purchase_drafts: 2,
          sales: 8,
          sale_drafts: 1,
          documents: { missing: 1, renderable: 2, source_only: 0, ready: 17 },
          document_queue: [],
          latest_report: null,
          latest_sync: null,
        },
      });
    }
    if (p === "/api/documents") {
      return route.fulfill({
        json: {
          total: 2,
          page: 1,
          per_page: 20,
          items: [
            {
              id: 1,
              doc_id: "doca",
              filename: "Hop-dong-SCADA-2026.pdf",
              signer_name: "INUT",
              signed: true,
              note: "",
              customer_id: 7,
              customer_name: "CÔNG TY DEMO",
              created_at: "2026-08-01T08:00:00Z",
              download_url: "/api/documents/1/download",
              nas_synced: true,
              doc_type: "hop_dong",
              signed_upload_name: "Hop-dong-SCADA-2026-signed.pdf",
              order_id: null,
              order_code: "",
            },
            {
              id: 2,
              doc_id: "docb",
              filename: "Bao-cao-nghiem-thu.md",
              signer_name: "",
              signed: false,
              note: "",
              customer_id: null,
              customer_name: null,
              created_at: "2026-08-02T08:00:00Z",
              download_url: "/api/documents/2/download",
              nas_synced: false,
              doc_type: "khac",
              signed_upload_name: "",
              order_id: null,
              order_code: "",
            },
          ],
        },
      });
    }
    if (p === "/api/my/documents") {
      return route.fulfill({
        json: [
          {
            id: 1,
            doc_id: "doca",
            filename: "Hop-dong-SCADA-2026.pdf",
            signer_name: "INUT",
            signed: true,
            created_at: "2026-08-01T08:00:00Z",
            download_url: "/api/documents/1/download",
            doc_type: "hop_dong",
          },
        ],
      });
    }
    if (p === "/api/my/invoices") {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/doc-views") {
      return route.fulfill({
        json: [
          {
            document_id: 1,
            filename: "Hop-dong-SCADA-2026.pdf",
            customer_name: "CÔNG TY DEMO",
            enabled: true,
            note: "",
            milestone_date: "",
            expires_at: null,
            total_views: 4,
            downloads: 1,
            neac_checks: 0,
            last_view_at: "2026-08-02T10:00:00Z",
          },
        ],
      });
    }
    if (p === "/api/doc-views/1" || p === "/api/documents/1/tracking") {
      return route.fulfill({
        json: {
          document_id: 1,
          filename: "Hop-dong-SCADA-2026.pdf",
          total: 1,
          page: 1,
          per_page: 50,
          views: [],
          items: [],
        },
      });
    }
    if (p === "/api/inv/email-sync/settings") {
      return route.fulfill({
        json: {
          enabled: true,
          provider: "zoho_api",
          accounts_url: "https://accounts.zoho.com",
          mail_api_url: "https://mail.zoho.com",
          client_id: "cid",
          client_secret_set: true,
          refresh_token_set: true,
          account_id: "acc1",
          folder_id: "inbox",
          query: "hoa don",
          days_back: 14,
        },
      });
    }
    if (p === "/api/inv/email-sync/runs") {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/spx/orders") {
      return route.fulfill({
        json: {
          items: [
            {
              id: 1,
              tracking_no: "SPXVN069100001",
              order_sn: "VN260801001",
              receiver_name: "Nguyễn Văn Minh",
              receiver_phone: "0909123456",
              receiver_address: "161 Trường Chinh, Tuy Hòa",
              cod_amount: 1200000,
              status: "Created",
              is_printed: false,
              created_at: "2026-08-01T08:00:00Z",
            },
          ],
          total: 1,
        },
      });
    }
    if (p === "/api/spx/stats") {
      return route.fulfill({ json: { total: 1, printed: 0, unprinted: 1, delivered: 0 } });
    }
    if (p === "/api/spx/settings") {
      return route.fulfill({ json: { enabled: true, printer_name: "TP732H", host: "192.168.1.10" } });
    }
    if (p === "/api/inv/warehouses") {
      return route.fulfill({
        json: [
          { id: 1, code: "HH", name: "Hàng hóa" },
          { id: 2, code: "NVL", name: "Nguyên vật liệu" },
          { id: 3, code: "TP", name: "Thành phẩm" },
        ],
      });
    }
    if (p === "/api/inv/stock" || p === "/api/inv/availability") {
      return route.fulfill({
        json: {
          rows: [
            {
              item_id: 1,
              ma_hang: "GW-4G",
              ten: "iNut Gateway 4G Pro",
              dvt: "bộ",
              warehouse_id: 1,
              warehouse_code: "HH",
              ton: 15,
              don_gia_bq: 2500000,
              gia_tri: 37500000,
              nhap_cuoi: "2026-08-01",
            },
          ],
          tong_gia_tri: 37500000,
          ngay: null,
        },
      });
    }
    if (p === "/api/inv/items") {
      return route.fulfill({
        json: [{ id: 1, ma_hang: "GW-4G", ten: "iNut Gateway 4G Pro", dvt: "bộ", note: "" }],
      });
    }
    if (p === "/api/bbbg/templates" || p === "/api/quote/templates") {
      return route.fulfill({ json: { templates: [{ key: "default", label: "Mặc định" }] } });
    }
    if (p === "/api/contract/defaults") {
      return route.fulfill({
        json: {
          ben_a: {
            company: "CÔNG TY CP ĐẦU TƯ & PT CÔNG NGHỆ INUT",
            mst: "4401053694",
            address: "161 Trường Chinh, Tuy Hòa",
            phone: "0972768491",
            rep: "NGÔ HUỲNH NGỌC KHÁNH",
            rep_title: "Giám đốc",
          },
          dieu_khoan: "",
          bank: { account_name: "INUT", account_number: "79713", bank_name: "Techcombank" },
          baotoan: { name: "", mst: "", address: "", email: "" },
        },
      });
    }
    if (p === "/api/inv/sale/summary") {
      return route.fulfill({
        json: {
          so_hd_count: 0,
          dt_phan_mem: 0,
          dt_hang_hoa: 0,
          doanh_thu_truoc_thue: 0,
          ln_truoc_nc: 0,
          ln_sau_nc: 0,
          ti_suat_ln: 0,
          co_uoc_tinh: false,
        },
      });
    }
    if (p === "/api/inv/ihoadon/dashboard") {
      return route.fulfill({
        json: {
          connected: true,
          account_name: "INUT",
          tax_code: "4401053694",
          total: 0,
          draft: 0,
          issued: 0,
          waiting: 0,
          web_url: "https://example.test/ihoadon",
        },
      });
    }
    if (p === "/api/inv/ihoadon/drafts") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (p === "/api/tax/policy") {
      return route.fulfill({
        json: {
          date: "2026-08-01",
          standard_eligible_rate: 8,
          reduction_to: "2026-12-31",
          legal_basis: ["Nghị định 174/2025/NĐ-CP"],
        },
      });
    }
    if (p === "/api/inv/purchase") {
      return route.fulfill({
        json: [
          {
            id: 1,
            so_hd: "0000123",
            ky_hieu: "1C26TAA",
            ngay: "2026-08-01",
            ten_ban: "CÔNG TY LINH KIỆN DEMO",
            mst_ban: "0312345678",
            tong_truoc_thue: 10000000,
            tong_thue: 1000000,
            tong_tien: 11000000,
            status: "draft",
            source: "tax_gdt",
            loai: "hang_hoa",
            confidence: 1,
            warnings: [],
            dup_of: null,
            created_at: "2026-08-01T08:00:00Z",
            doc_url: "",
            lines: [],
          },
        ],
      });
    }
    if (
      p === "/api/customers" ||
      p === "/api/orders" ||
      p === "/api/products" ||
      p === "/api/contract/drafts"
    ) {
      return route.fulfill({ json: [] });
    }
    if (
      p === "/api/inv/sale" ||
      p === "/api/inv/issues" ||
      p === "/api/inv/productions" ||
      p === "/api/inv/recipes" ||
      p === "/api/inv/customs"
    ) {
      return route.fulfill({ json: [] });
    }
    if (
      p === "/api/inv/customs-drive/sources" ||
      p === "/api/inv/customs-drive/folders" ||
      p === "/api/inv/customs-drive/check-tasks"
    ) {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/inv/customs-drive/checks") {
      return route.fulfill({ json: { items: [], sources: [], folders: [], total: 0 } });
    }
    if (
      p === "/api/tax/reports" ||
      p === "/api/tax/review" ||
      p === "/api/payroll/periods" ||
      p === "/api/payroll/imports" ||
      p === "/api/payroll/employees" ||
      p === "/api/audit" ||
      p === "/api/trademarks" ||
      p === "/api/facebook/conversations"
    ) {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/payroll/hr-summary") {
      return route.fulfill({
        json: {
          year: 2026,
          employees: [],
          totals: { net_payable: 0, paid: 0, outstanding: 0, pit_withheld: 0, annual_pit: 0 },
        },
      });
    }
    if (p === "/api/payroll/forecast") {
      return route.fulfill({
        json: {
          year: 2026,
          actual_through: "2026-07",
          growth_rate: 0,
          future_months: [],
          baseline: { gross_income: 0, net_payable: 0, annual_pit: 0, pit_withheld: 0 },
          recommended: {
            key: "base",
            label: "Cơ bản",
            gross_bonus: 0,
            additional_pit: 0,
            net_bonus: 0,
            effective_tax_rate: 0,
          },
          scenarios: [],
          employees: [],
          assumptions: [],
        },
      });
    }
    if (p === "/api/payroll/sync-drive/status") {
      return route.fulfill({ json: { job: null } });
    }
    if (p === "/api/tax/session") {
      return route.fulfill({ json: { valid: false, logged_in: false, expires_at: null } });
    }
    if (p === "/api/tax/credentials") {
      return route.fulfill({ json: { mst: "4401053694", has_password: true } });
    }
    if (p === "/api/tax/captcha") {
      return route.fulfill({
        json: {
          key: "cap-1",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="10" y="25">ABC</text></svg>',
        },
      });
    }
    if (p === "/api/tax-defense/overview") {
      const emptyYear = (y: string) => ({
        year: y,
        invoice_count_gross: 0,
        invoice_count_net: 0,
        total_pretax: 0,
        total_vat: 0,
        total_payment: 0,
        gross_payment: 0,
        adjusted_cancelled_count: 0,
        quarters: {},
        tiers: {},
        tax_rates: {},
        customers: {},
      });
      return route.fulfill({
        json: {
          years: ["2022", "2023", "2024", "2025"],
          summary_matrix: [
            {
              year: "2024",
              sale_invoices_count: 10,
              revenue_pretax: 1000000000,
              purchase_invoices_count: 8,
              purchase_pretax: 600000000,
            },
            {
              year: "2025",
              sale_invoices_count: 12,
              revenue_pretax: 1200000000,
              purchase_invoices_count: 9,
              purchase_pretax: 700000000,
            },
          ],
          revenue_details: {
            "2022": emptyYear("2022"),
            "2023": emptyYear("2023"),
            "2024": emptyYear("2024"),
            "2025": emptyYear("2025"),
          },
          cost_details: {},
          partners: [],
          status06_alerts: [],
        },
      });
    }
    if (p === "/api/tax-defense/justification-dossier") {
      return route.fulfill({ json: { title: "", summary: "", sections: [], full_text: "" } });
    }
    if (p === "/api/tax-defense/accounting-fee-monitor") {
      return route.fulfill({
        json: {
          quarter: "2026-Q3",
          breakdown: {
            sales_count: 10,
            regular_purchases_count: 10,
            customs_billed: 2,
            total_billed_documents: 22,
          },
          current_tier: { tier: 2, label: "6 - 30 HĐ/quý", fee_quarter: 3600000, max: 30 },
          thresholds: { remaining_before_jump: 8, alarm_gap: 5, is_alarm: false },
        },
      });
    }
    if (p === "/api/piecework/contracts") {
      return route.fulfill({
        json: {
          contracts: [],
          total: 0,
          summary: { total: 0, pending_docs: 0, ready_to_pay: 0, completed: 0, total_amount: 0 },
        },
      });
    }
    if (p === "/api/piecework/contractors") {
      return route.fulfill({ json: { contractors: [], total: 0 } });
    }
    if (p === "/api/bidding/dossier-reviews") {
      return route.fulfill({ json: [] });
    }
    if (
      p === "/api/bidding/search" ||
      p === "/api/bidding/bookmarks" ||
      p === "/api/bidding/watchlist" ||
      p === "/api/bidding/won-packages"
    ) {
      return route.fulfill({
        json: { items: [], total: 0, page: 1, page_size: 10, total_pages: 1 },
      });
    }
    if (p === "/api/bidding/contractors/crm-scan") {
      return route.fulfill({
        json: { total_crm_customers: 0, total_won_contractors: 0, total_won_value_vnd: 0, items: [] },
      });
    }
    if (p === "/api/standards/statistics") {
      return route.fulfill({
        json: { total_standards: 10, mandatory_count: 6, total_labs: 4, ministries: [] },
      });
    }
    if (p === "/api/standards/search" || p === "/api/standards/tqc/search") {
      return route.fulfill({ json: { items: [], total: 0, results: [] } });
    }
    if (
      p === "/api/standards/hs-mappings" ||
      p === "/api/standards/testing-labs" ||
      p === "/api/standards/playbooks"
    ) {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/standards/game/state") {
      return route.fulfill({
        json: {
          current_level: 1,
          current_level_title: "Tân binh",
          current_exp: 0,
          max_exp: 100,
          progress_percent: 0,
          completed_quests_count: 0,
          total_quests: 0,
          ai_companion_cheer: "",
          quests: [],
        },
      });
    }
    if (p === "/api/standards/risk-classification/statistics") {
      return route.fulfill({
        json: {
          total_items: 0,
          high_risk_count: 0,
          medium_risk_count: 0,
          low_risk_count: 0,
          categories: [],
        },
      });
    }
    if (
      p === "/api/standards/risk-classification/catalog" ||
      p === "/api/standards/risk-classification/classify"
    ) {
      return route.fulfill({ json: { items: [], total: 0, matches: [] } });
    }
    if (p === "/api/standards/tqc/status") {
      return route.fulfill({
        json: { search_mode: "official_exact_plus_local_index", local_count: 5 },
      });
    }
    if (p === "/api/web-ads/overview") {
      return route.fulfill({
        json: {
          kpis: { total_visits: 100, total_leads: 5, conversion_rate: 5, won_leads: 1 },
          leads: [],
          campaigns: [],
          daily: [],
          sources: [],
        },
      });
    }
    if (p === "/api/gov-radar") {
      return route.fulfill({
        json: { items: [], total: 0, stats: { total: 0, urgent: 0, unread: 0 } },
      });
    }
    if (p === "/api/pymid/catalog") {
      return route.fulfill({ json: { items: [], categories: [] } });
    }
    if (p === "/api/pymid/orders" || p === "/api/pymid/staff") {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/training/status") {
      return route.fulfill({ json: { enabled: true, healthy: true, knowledge_count: 1 } });
    }
    if (p === "/api/training/knowledge") {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/telegram/status") {
      return route.fulfill({
        json: { configured: true, connected: false, bot_username: "inut_bot" },
      });
    }
    if (p === "/api/nas/status") {
      return route.fulfill({ json: { enabled: false, synced: 0, total: 0, pending: 0 } });
    }
    if (p === "/api/nas/list") {
      return route.fulfill({ json: { path: "", items: [] } });
    }
    if (p === "/api/settings") {
      return route.fulfill({
        json: {
          ai_enabled: false,
          ai_base_url: "",
          ai_api_key_set: false,
          ai_model: "",
          ai_max_tokens: 0,
          ai_timeout: 30,
          nas_enabled: false,
          nas_host: "",
          nas_share: "",
          nas_user: "",
          nas_password_set: false,
          nas_base_path: "",
          nas_timeout: 10,
          ihoadon_enabled: false,
          ihoadon_base_url: "",
          ihoadon_tax_code: "",
          ihoadon_username: "",
          ihoadon_password_set: false,
          ihoadon_timeout: 30,
          smtp_host: "",
          smtp_port: 587,
          smtp_username: "",
          smtp_password_set: false,
          smtp_from: "",
          smtp_to: "",
        },
      });
    }
    return route.fulfill({ json: {} });
  });
}

// ---------------------------------------------------------------------------
// G6-Login: Unauthenticated /login screen visual ergonomics & WCAG 2.1 AA
// ---------------------------------------------------------------------------
test("G6-Login: /login passes visual ergonomics, touch targets & WCAG 2.1 AA", async ({
  page,
}, testInfo) => {
  const mode = resolveAuditMode(testInfo.project.name);
  test.skip(
    !mode,
    "G6 visual audit runs on desktop-1280 (1440×900), mobile-390-ios (390×844), and mobile-360 (360×800)",
  );

  if (mode === "desktop-1440") {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.route("**/api/me", (r) =>
    r.fulfill({ status: 401, json: { detail: "Chua dang nhap" } }),
  );
  await page.route("**/api/public/site-config", (r) =>
    r.fulfill({
      json: {
        contact: {
          company: "CÔNG TY CP ĐẦU TƯ & PT CÔNG NGHỆ INUT",
          address: "161 Trường Chinh, Tuy Hòa",
          phone: "0901234567",
          email: "info@inut.vn",
        },
      },
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => document.fonts?.ready);

  const metrics = await page.evaluate((isMobile) => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const brokenImgs: string[] = [];
    for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
      const r = img.getBoundingClientRect();
      const st = getComputedStyle(img);
      if (st.display === "none" || st.visibility === "hidden" || (r.width === 0 && r.height === 0)) {
        continue;
      }
      if (!img.complete || img.naturalWidth === 0) {
        brokenImgs.push(img.getAttribute("src") || img.alt || "(img)");
      }
    }

    const smallInputs: string[] = [];
    const smallTargets: string[] = [];
    if (isMobile) {
      for (const el of document.querySelectorAll<HTMLElement>(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="range"]), select, textarea',
      )) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || st.display === "none" || st.visibility === "hidden") {
          continue;
        }
        const fs = parseFloat(st.fontSize);
        if (fs < 15.9) smallInputs.push(`${el.tagName}:${fs.toFixed(1)}px`);
      }
      for (const btn of document.querySelectorAll<HTMLElement>('button[type="submit"], .ui-btn--primary')) {
        const r = btn.getBoundingClientRect();
        const st = getComputedStyle(btn);
        if (r.width === 0 || r.height === 0 || st.display === "none" || st.visibility === "hidden") {
          continue;
        }
        if (r.width < 43.5 || r.height < 43.5) {
          smallTargets.push(`${btn.textContent?.trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
    }

    return { overflow, brokenImgs, smallInputs, smallTargets };
  }, mode !== "desktop-1440");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const severeAxe = axe.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );

  expect(pageErrors, `/login pageerrors (${mode})`).toEqual([]);
  expect(metrics.overflow, `/login overflow (${mode})`).toBeLessThanOrEqual(1);
  expect(metrics.brokenImgs, `/login broken imgs (${mode})`).toEqual([]);
  expect(metrics.smallInputs, `/login inputs<16px (${mode})`).toEqual([]);
  expect(metrics.smallTargets, `/login touch targets<44px (${mode})`).toEqual([]);
  expect(
    severeAxe.map((v) => `${v.id}(${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("; ")}`),
    `/login WCAG AA critical/serious (${mode})`,
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// G6-36Routes: Full 36-Route Visual Ergonomics, Typography & WCAG 2.1 AA Matrix
// Split into 3 parallel batches of 12 routes so CI stays fast and resilient.
// ---------------------------------------------------------------------------
const ROUTE_BATCHES = [
  { label: "Batch 1/3 (routes 1-12)", routes: ALL_ADMIN_ROUTES.slice(0, 12) },
  { label: "Batch 2/3 (routes 13-24)", routes: ALL_ADMIN_ROUTES.slice(12, 24) },
  { label: "Batch 3/3 (routes 25-36)", routes: ALL_ADMIN_ROUTES.slice(24, 36) },
] as const;

for (const batch of ROUTE_BATCHES) {
  test(`G6-36Routes ${batch.label}: visual ergonomics, typography & WCAG 2.1 AA`, async ({
    page,
  }, testInfo) => {
    const mode = resolveAuditMode(testInfo.project.name);
    test.skip(
      !mode,
      "G6 visual audit runs on desktop-1280 (1440×900), mobile-390-ios (390×844), and mobile-360 (360×800)",
    );

    test.setTimeout(180_000);

    if (mode === "desktop-1440") {
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    let activeRoute = "";
    await installComprehensiveMocks(page, () =>
      activeRoute === "/ho-so-cua-toi"
        ? {
            username: "customer_demo",
            role: "customer",
            portal_scope: "customer",
            customer_name: "CÔNG TY DEMO",
          }
        : {},
    );

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(`${activeRoute}: ${String(err)}`));

    const failures: string[] = [];
    const isDesktop = mode === "desktop-1440";
    const isMobile = !isDesktop;

    for (const routePath of batch.routes) {
    activeRoute = routePath;
    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.locator("main.app-content .ui-page-header").first().waitFor({
      state: "visible",
      timeout: 8000,
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => document.fonts?.ready);

    const domAudit = await page.evaluate(
      ({ route, desktop, mobile, auditMode }) => {
        const issues: string[] = [];
        const vw = window.innerWidth;
        const isHero = route === "/";

        const isVisible = (el: Element): boolean => {
          const st = getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) === 0) {
            return false;
          }
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };

        // (b) 0px horizontal overflow
        const overflow = document.documentElement.scrollWidth - vw;
        if (overflow > 1) {
          issues.push(`overflow=${overflow}px`);
        }

        // (c) 0 broken visible <img>
        for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
          const st = getComputedStyle(img);
          const r = img.getBoundingClientRect();
          if (st.display === "none" || st.visibility === "hidden" || (r.width === 0 && r.height === 0)) {
            continue;
          }
          if (!img.complete || img.naturalWidth === 0) {
            issues.push(`broken-img(${img.getAttribute("src") || img.alt || "no-src"})`);
          }
        }

        // (d) 0 clipped tabs / header actions / topbar pills
        const clipSelectors = [
          ".ui-tab",
          '[role="tab"]',
          ".ui-page-header-actions button",
          ".ui-page-header-actions a",
          ".topbar-route-pill",
          ".topbar .logout",
          ".topbar-user button",
        ].join(", ");
        const clipped: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(clipSelectors)) {
          if (!isVisible(el)) continue;
          const st = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          // Internal horizontal text clipping (ignore intentional ellipsis on narrow mobile route pill)
          const allowMobileEllipsis =
            mobile && el.classList.contains("topbar-route-pill") && st.textOverflow === "ellipsis";
          if (!allowMobileEllipsis && el.scrollWidth > el.clientWidth + 1) {
            clipped.push(
              `${el.className.toString().split(/\s+/)[0] || el.tagName}(sw=${el.scrollWidth}>cw=${el.clientWidth},"${(el.textContent || "").trim().slice(0, 22)}")`,
            );
          }
          // Right-edge viewport clipping (skip tabs inside horizontally scrollable tab bars on mobile)
          const insideScrollTabs = Boolean(el.closest(".ui-tabs-list, .ui-tabs-wrap"));
          if ((!insideScrollTabs || desktop) && r.right > vw + 1) {
            clipped.push(
              `offscreen-right(${el.className.toString().split(/\s+/)[0] || el.tagName},right=${Math.round(r.right)}>vw=${vw})`,
            );
          }
        }
        // Desktop: tab strip itself must not clip tabs horizontally
        if (desktop) {
          for (const strip of document.querySelectorAll<HTMLElement>(
            ".ui-tabs-list, [role='tablist']",
          )) {
            if (!isVisible(strip)) continue;
            if (strip.scrollWidth > strip.clientWidth + 2) {
              clipped.push(
                `tablist-overflow(sw=${strip.scrollWidth}>cw=${strip.clientWidth})`,
              );
            }
          }
        }
        if (clipped.length > 0) {
          issues.push(`clipped=[${clipped.slice(0, 4).join(", ")}]`);
        }

        // (e) Desktop 1440×900 PageHeader height: <= 88px compact (35/36), <= 140px hero (/)
        const pageHeader = document.querySelector<HTMLElement>("main.app-content .ui-page-header");
        if (!pageHeader || !isVisible(pageHeader)) {
          issues.push("missing-.ui-page-header");
        } else if (desktop) {
          const h = Math.round(pageHeader.getBoundingClientRect().height);
          const cap = isHero ? 140 : 88;
          if (h > cap) {
            issues.push(`page-header-height=${h}px (cap <=${cap}px)`);
          }
        }

        // (f) Above-the-fold first primary content container
        const primaryContentSel = [
          ".ui-kpi-strip",
          ".ui-section-card",
          ".ui-data-view",
          ".ui-tabs-wrap",
          ".ui-tabs",
          ".ui-filter-bar",
          ".ui-split",
          ".ui-step-flow",
          "table",
          "form",
          ".ui-empty-state",
        ].join(", ");
        const mainEl = document.querySelector("main.app-content");
        if (mainEl) {
          let minTop = Infinity;
          let matchedSel = "";
          for (const el of mainEl.querySelectorAll<HTMLElement>(primaryContentSel)) {
            if (el.closest(".ui-page-header")) continue;
            if (!isVisible(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.top < minTop) {
              minTop = r.top;
              matchedSel = el.className.toString().split(/\s+/)[0] || el.tagName.toLowerCase();
            }
          }
          if (!Number.isFinite(minTop)) {
            issues.push("no-primary-content-container");
          } else {
            const foldCap = desktop ? 420 : auditMode === "mobile-390" ? 480 : 520;
            if (minTop > foldCap) {
              issues.push(
                `below-fold(${matchedSel} y=${Math.round(minTop)}px > ${foldCap}px)`,
              );
            }
          }
        }

        // (g) Typography: h1 fontFamily/fontSize + 0 readable body text < 12px
        const h1 =
          document.querySelector<HTMLElement>("main.app-content h1.ui-page-header-title") ||
          document.querySelector<HTMLElement>("main.app-content .ui-page-header-title") ||
          document.querySelector<HTMLElement>("main.app-content h1");
        if (!h1 || !isVisible(h1)) {
          issues.push("missing-h1");
        } else if (desktop) {
          const st = getComputedStyle(h1);
          const fam = st.fontFamily.toLowerCase();
          const fs = parseFloat(st.fontSize);
          if (isHero) {
            if (!fam.includes("georgia")) {
              issues.push(`hero-h1-font="${st.fontFamily}" (expected Georgia)`);
            }
            if (fs < 28 || fs > 32) {
              issues.push(`hero-h1-size=${fs}px (expected 30±2px)`);
            }
          } else {
            if (!fam.includes("inter")) {
              issues.push(`h1-font="${st.fontFamily}" (expected Inter)`);
            }
            if (fs < 23 || fs > 25) {
              issues.push(`h1-size=${fs}px (expected 24±1px)`);
            }
          }
        }

        // Readable body text >= 12px inside main.app-content
        const tinyText: string[] = [];
        if (mainEl) {
          const bodySel = "p, td, th, li, label, button, .ui-card-body";
          for (const el of mainEl.querySelectorAll<HTMLElement>(bodySel)) {
            if (!isVisible(el)) continue;
            if (el.closest(".sr-only, svg")) continue;
            const txt = (el.textContent || "").trim();
            if (!txt) continue;
            const st = getComputedStyle(el);
            const fs = parseFloat(st.fontSize);
            if (fs >= 11.9) continue;
            // Intentional 11px (--text-label) uppercase micro tags / eyebrows from 01-tokens.css
            const isIntentionalMicroLabel =
              fs >= 10.9 &&
              (el.classList.contains("ui-eyebrow") ||
                el.classList.contains("eyebrow") ||
                el.classList.contains("ui-page-header-eyebrow") ||
                st.textTransform === "uppercase");
            if (isIntentionalMicroLabel) continue;
            tinyText.push(
              `${el.tagName.toLowerCase()}.${el.className.toString().split(/\s+/)[0] || ""}:${fs.toFixed(1)}px("${txt.slice(0, 18)}")`,
            );
          }
        }
        if (tinyText.length > 0) {
          issues.push(`text<12px=[${tinyText.slice(0, 4).join(", ")}]`);
        }

        // (h) Mobile (390×844 & 360×800): inputs >= 16px & primary touch targets >= 44×44px
        if (mobile) {
          const smallInputs: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>(
            'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="range"]), select, textarea',
          )) {
            if (!isVisible(el)) continue;
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 15.9) {
              smallInputs.push(
                `${el.tagName.toLowerCase()}.${el.className.toString().split(/\s+/)[0] || ""}:${fs.toFixed(1)}px`,
              );
            }
          }
          if (smallInputs.length > 0) {
            issues.push(`mobile-inputs<16px=[${smallInputs.slice(0, 4).join(", ")}]`);
          }

          const smallTouch: string[] = [];
          const primaryTouchSel = [
            "button.hamburger",
            ".bottom-nav button",
            ".ui-page-header-actions button",
            ".ui-page-header-actions a",
            ".ui-btn--primary",
            ".ui-btn--lg",
            'button[type="submit"]',
            ".ui-filter-bar-toggle",
          ].join(", ");
          for (const el of document.querySelectorAll<HTMLElement>(primaryTouchSel)) {
            if (!isVisible(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 43.5 || r.height < 43.5) {
              smallTouch.push(
                `${el.className.toString().split(/\s+/)[0] || el.tagName.toLowerCase()}:${Math.round(r.width)}x${Math.round(r.height)}("${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 18)}")`,
              );
            }
          }
          if (smallTouch.length > 0) {
            issues.push(`touch<44px=[${smallTouch.slice(0, 4).join(", ")}]`);
          }
        }

        return issues;
      },
      { route: routePath, desktop: isDesktop, mobile: isMobile, auditMode: mode },
    );

    if (domAudit.length > 0) {
      failures.push(`${routePath} [DOM]: ${domAudit.join(" | ")}`);
    }

    // (i) @axe-core/playwright WCAG 2.1 AA: 0 critical or serious violations
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const severeAxe = axe.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    if (severeAxe.length > 0) {
      const summary = severeAxe
        .map(
          (v) =>
            `${v.id}(${v.impact}, ${v.nodes.length}x: ${v.nodes
              .slice(0, 2)
              .map((n) => n.target.join(" "))
              .join(", ")})`,
        )
        .join("; ");
      failures.push(`${routePath} [AXE]: ${summary}`);
    }
  }

  expect(pageErrors, `Uncaught pageerrors in ${batch.label} (${mode})`).toEqual([]);
  expect(failures, `G6 visual audit failures in ${batch.label} (${mode}):\n${failures.join("\n")}`).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// G6-DarkMode: Dark Mode Persistence, 0px Overflow & WCAG 2.1 AA Contrast Audit
// ---------------------------------------------------------------------------
const DARK_MODE_AUDIT_ROUTES = [
  "/",
  "/ho-so",
  "/ky-so",
  "/dau-thau",
  "/hop-dong-khoan",
  "/standards",
  "/shipping-spx",
  "/bang-luong",
] as const;

test("G6-DarkMode: dark theme persists across reload & passes WCAG 2.1 AA across 8 routes", async ({
  page,
}, testInfo) => {
  const mode = resolveAuditMode(testInfo.project.name);
  test.skip(
    mode !== "desktop-1440" && mode !== "mobile-390",
    "Dark mode WCAG 2.1 AA audit runs on desktop-1280 (1440×900) and mobile-390-ios (390×844)",
  );

  test.setTimeout(120_000);

  if (mode === "desktop-1440") {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await installComprehensiveMocks(page);

  const pageErrors: string[] = [];
  let activeRoute = "/";
  page.on("pageerror", (err) => pageErrors.push(`${activeRoute}: ${String(err)}`));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("main.app-content .ui-page-header").first().waitFor({
    state: "visible",
    timeout: 8000,
  });

  // Toggle Dark Mode via topbar theme toggle & verify localStorage + reload persistence
  const themeToggle = page.getByTestId("theme-toggle");
  await expect(themeToggle).toBeVisible();
  await themeToggle.click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("ksp_theme"))).toBe("dark");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("main.app-content .ui-page-header").first().waitFor({
    state: "visible",
    timeout: 8000,
  });
  expect(
    await page.evaluate(() => document.documentElement.dataset.theme),
    `[data-theme="dark"] must persist after reload (${mode})`,
  ).toBe("dark");

  const failures: string[] = [];

  for (const routePath of DARK_MODE_AUDIT_ROUTES) {
    activeRoute = routePath;
    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.locator("main.app-content .ui-page-header").first().waitFor({
      state: "visible",
      timeout: 8000,
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => document.fonts?.ready);

    const check = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme || "",
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));

    if (check.theme !== "dark") {
      failures.push(`${routePath} [THEME]: expected dark, got "${check.theme}"`);
    }
    if (check.overflow > 1) {
      failures.push(`${routePath} [DOM]: overflow=${check.overflow}px`);
    }

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const severeAxe = axe.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    if (severeAxe.length > 0) {
      const summary = severeAxe
        .map(
          (v) =>
            `${v.id}(${v.impact}, ${v.nodes.length}x: ${v.nodes
              .slice(0, 2)
              .map((n) => n.target.join(" "))
              .join(", ")})`,
        )
        .join("; ");
      failures.push(`${routePath} [AXE-DARK]: ${summary}`);
    }
  }

  expect(pageErrors, `Uncaught pageerrors in dark mode (${mode})`).toEqual([]);
  expect(
    failures,
    `G6 Dark Mode audit failures (${mode}):\n${failures.join("\n")}`,
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// G6-CommandPalette: Ctrl+K Vietnamese Diacritic-Insensitive Navigation & Escape
// ---------------------------------------------------------------------------
test("G6-CommandPalette: Ctrl+K opens, filters Vietnamese queries, navigates & closes on Escape", async ({
  page,
}, testInfo) => {
  const mode = resolveAuditMode(testInfo.project.name);
  test.skip(mode !== "desktop-1440", "Ctrl+K Command Palette keyboard test runs on desktop-1280");

  await page.setViewportSize({ width: 1440, height: 900 });
  await installComprehensiveMocks(page);

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("main.app-content .ui-page-header").first().waitFor({
    state: "visible",
    timeout: 8000,
  });

  // 1. Open via Ctrl+K, search "khoan", press Enter -> navigates to /hop-dong-khoan
  await page.keyboard.press("Control+k");
  const dialog = page.getByTestId("cmdk-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");

  const input = page.getByTestId("cmdk-input");
  await expect(input).toBeVisible();
  await input.fill("khoan");
  await expect(page.getByTestId("cmdk-list").locator('[role="option"]').first()).toBeVisible();
  await input.press("Enter");

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/hop-dong-khoan/);
  await page.locator("main.app-content .ui-page-header").first().waitFor({
    state: "visible",
    timeout: 8000,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);

  // 2. Open via Ctrl+K, search "dau thau", press Enter -> navigates to /bidding or /dau-thau
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await input.fill("dau thau");
  await expect(page.getByTestId("cmdk-list").locator('[role="option"]').first()).toBeVisible();
  await input.press("Enter");

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/(bidding|dau-thau)/);
  await page.locator("main.app-content .ui-page-header").first().waitFor({
    state: "visible",
    timeout: 8000,
  });

  // 3. Open via Ctrl+K, press Escape -> closes cleanly
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  expect(pageErrors, "Uncaught pageerrors during Ctrl+K Command Palette flow").toEqual([]);
});

// ---------------------------------------------------------------------------
// G6-DensityToggle: Compact Table Density Mode Persistence & 0px Overflow
// ---------------------------------------------------------------------------
test("G6-DensityToggle: compact density persists across reload with 0px overflow", async ({
  page,
}, testInfo) => {
  const mode = resolveAuditMode(testInfo.project.name);
  test.skip(mode !== "desktop-1440", "Density toggle test runs on desktop-1280");

  await page.setViewportSize({ width: 1440, height: 900 });
  await installComprehensiveMocks(page);

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/ho-so", { waitUntil: "domcontentloaded" });
  await page.locator("main.app-content .ui-page-header").first().waitFor({
    state: "visible",
    timeout: 8000,
  });

  const densityToggle = page.getByTestId("density-toggle");
  await expect(densityToggle).toBeVisible();
  await densityToggle.click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.density))
    .toBe("compact");
  expect(await page.evaluate(() => localStorage.getItem("ksp_density"))).toBe("compact");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("main.app-content .ui-page-header").first().waitFor({
    state: "visible",
    timeout: 8000,
  });

  expect(await page.evaluate(() => document.documentElement.dataset.density)).toBe("compact");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(pageErrors, "Uncaught pageerrors during density toggle").toEqual([]);
});

// ---------------------------------------------------------------------------
// G6-PrintMedia: @media print Hides Navigation Chrome & Filter Bar
// ---------------------------------------------------------------------------
test("G6-PrintMedia: @media print hides .sidebar, .topbar & .ui-filter-bar on /ho-so", async ({
  page,
}, testInfo) => {
  const mode = resolveAuditMode(testInfo.project.name);
  test.skip(mode !== "desktop-1440", "@media print sanity test runs on desktop-1280");

  await page.setViewportSize({ width: 1440, height: 900 });
  await installComprehensiveMocks(page);

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/ho-so", { waitUntil: "domcontentloaded" });
  await page.locator("main.app-content .ui-page-header").first().waitFor({
    state: "visible",
    timeout: 8000,
  });

  // Ensure elements exist & render in screen media before switching to print
  const screenCheck = await page.evaluate(() => ({
    sidebar: Boolean(document.querySelector(".sidebar")),
    topbar: Boolean(document.querySelector(".topbar")),
    filterBar: Boolean(document.querySelector(".ui-filter-bar")),
  }));
  expect(screenCheck).toEqual({ sidebar: true, topbar: true, filterBar: true });

  await page.emulateMedia({ media: "print" });

  const printDisplay = await page.evaluate(() => {
    const disp = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : null;
    };
    return {
      sidebar: disp(".sidebar"),
      topbar: disp(".topbar"),
      filterBar: disp(".ui-filter-bar"),
      main: disp("main.app-content"),
    };
  });

  expect(printDisplay.sidebar, ".sidebar in @media print").toBe("none");
  expect(printDisplay.topbar, ".topbar in @media print").toBe("none");
  expect(printDisplay.filterBar, ".ui-filter-bar in @media print").toBe("none");
  expect(printDisplay.main, "main.app-content remains visible in @media print").not.toBe("none");
  expect(pageErrors, "Uncaught pageerrors during @media print test").toEqual([]);
});
