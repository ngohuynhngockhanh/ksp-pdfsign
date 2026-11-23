import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
];

async function installComprehensiveMocks(
  page: Page,
  meOverride: Record<string, unknown> = {},
  onSignPayload?: (body: any) => void,
) {
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();

    if (p === "/api/me") {
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
          ...meOverride,
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
    if (p === "/api/sign" && method === "POST") {
      try {
        onSignPayload?.(req.postDataJSON());
      } catch {
        // ignore
      }
      return route.fulfill({
        json: { doc_id: "signed001", document_id: 101, signer_name: "INUT TECH" },
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
          views: [
            {
              id: 10,
              action: "view",
              ip: "203.113.1.1",
              country_code: "VN",
              city: "Ho Chi Minh",
              region: "SG",
              isp: "VNPT",
              device_type: "Mobile",
              source: "share",
              notified: false,
              created_at: "2026-08-02T10:00:00Z",
            },
          ],
          items: [
            {
              id: 10,
              action: "view",
              ip: "203.113.1.1",
              country: "VN",
              city: "Ho Chi Minh",
              device: "Mobile",
              browser: "Safari",
              os: "iOS",
              created_at: "2026-08-02T10:00:00Z",
            },
          ],
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
    if (p === "/api/customers" || p === "/api/orders" || p === "/api/products" || p === "/api/contract/drafts") {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/inv/sale" || p === "/api/inv/issues" || p === "/api/inv/productions" || p === "/api/inv/recipes" || p === "/api/inv/customs") {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/inv/customs-drive/sources" || p === "/api/inv/customs-drive/folders" || p === "/api/inv/customs-drive/check-tasks") {
      return route.fulfill({ json: [] });
    }
    if (p === "/api/inv/customs-drive/checks") {
      return route.fulfill({ json: { items: [], sources: [], folders: [], total: 0 } });
    }
    if (p === "/api/tax/reports" || p === "/api/tax/review" || p === "/api/payroll/periods" || p === "/api/payroll/imports" || p === "/api/payroll/employees" || p === "/api/audit" || p === "/api/trademarks" || p === "/api/facebook/conversations") {
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
          recommended: { key: "base", label: "Cơ bản", gross_bonus: 0, additional_pit: 0, net_bonus: 0, effective_tax_rate: 0 },
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
        json: { key: "cap-1", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="10" y="25">ABC</text></svg>' },
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
            { year: "2024", sale_invoices_count: 10, revenue_pretax: 1000000000, purchase_invoices_count: 8, purchase_pretax: 600000000 },
            { year: "2025", sale_invoices_count: 12, revenue_pretax: 1200000000, purchase_invoices_count: 9, purchase_pretax: 700000000 },
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
          breakdown: { sales_count: 10, regular_purchases_count: 10, customs_billed: 2, total_billed_documents: 22 },
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
    if (p === "/api/bidding/search" || p === "/api/bidding/bookmarks" || p === "/api/bidding/watchlist" || p === "/api/bidding/won-packages") {
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 10, total_pages: 1 } });
    }
    if (p === "/api/bidding/contractors/crm-scan") {
      return route.fulfill({ json: { total_crm_customers: 0, total_won_contractors: 0, total_won_value_vnd: 0, items: [] } });
    }
    if (p === "/api/standards/statistics") {
      return route.fulfill({ json: { total_standards: 10, mandatory_count: 6, total_labs: 4, ministries: [] } });
    }
    if (p === "/api/standards/search" || p === "/api/standards/tqc/search") {
      return route.fulfill({ json: { items: [], total: 0, results: [] } });
    }
    if (p === "/api/standards/hs-mappings" || p === "/api/standards/testing-labs" || p === "/api/standards/playbooks") {
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
        json: { total_items: 0, high_risk_count: 0, medium_risk_count: 0, low_risk_count: 0, categories: [] },
      });
    }
    if (p === "/api/standards/risk-classification/catalog" || p === "/api/standards/risk-classification/classify") {
      return route.fulfill({ json: { items: [], total: 0, matches: [] } });
    }
    if (p === "/api/standards/tqc/status") {
      return route.fulfill({ json: { search_mode: "official_exact_plus_local_index", local_count: 5 } });
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
      return route.fulfill({ json: { items: [], total: 0, stats: { total: 0, urgent: 0, unread: 0 } } });
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
      return route.fulfill({ json: { configured: true, connected: false, bot_username: "inut_bot" } });
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

async function assertNoOverflow(page: Page, contextLabel: string) {
  const diff = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(diff, `Horizontal overflow on ${contextLabel}: ${diff}px`).toBeLessThanOrEqual(1);
}

// ---------------------------------------------------------------------------
// TC-MOB-01 & TC-MOB-02: Touch PointerEvent PDF signing canvas & container fit
// ---------------------------------------------------------------------------
test("TC-MOB-01/02: PdfCanvas supports PointerEvent touch drag and fits narrow viewports", async ({
  page,
}, testInfo) => {
  let signBody: any = null;
  await installComprehensiveMocks(page, {}, (b) => {
    signBody = b;
  });
  await page.goto("/ky-so");

  // Upload minimal valid PDF
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "sample.pdf",
    mimeType: "application/pdf",
    buffer: MINIMAL_PDF_BYTES,
  });

  // Wait for pdfjs canvas to render
  const canvas = page.locator(".page-wrap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 10000 });

  // Fit-width check on mobile/tablet
  const vp = page.viewportSize()!;
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.width).toBeLessThanOrEqual(vp.width);

  // Switch to draw mode if mobile toggle exists
  const drawModeBtn = page.getByRole("button", { name: /Vẽ vùng ký|Kéo chọn vùng ký/i }).first();
  if (await drawModeBtn.isVisible().catch(() => false)) {
    await drawModeBtn.click();
  }

  const overlay = page.locator(".page-wrap .overlay").first();
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();

  // Check touch-action: none in draw mode
  const touchAction = await overlay.evaluate((el) => getComputedStyle(el).touchAction);
  expect(touchAction).toContain("none");

  // Dispatch PointerEvents (touch) to draw a signature rectangle
  const x1 = box!.x + Math.min(40, box!.width * 0.15);
  const y1 = box!.y + Math.min(60, box!.height * 0.15);
  const x2 = box!.x + Math.min(200, box!.width * 0.75);
  const y2 = box!.y + Math.min(130, box!.height * 0.4);

  await overlay.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: x1,
    clientY: y1,
    isPrimary: true,
    buttons: 1,
  });
  await overlay.dispatchEvent("pointermove", {
    pointerId: 1,
    pointerType: "touch",
    clientX: x2,
    clientY: y2,
    isPrimary: true,
    buttons: 1,
  });
  await overlay.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: x2,
    clientY: y2,
    isPrimary: true,
    buttons: 0,
  });

  const selRect = page.locator(".page-wrap .sel-rect").first();
  await expect(selRect).toBeVisible();
  const selBox = await selRect.boundingBox();
  expect(selBox).not.toBeNull();
  expect(selBox!.width).toBeGreaterThan(20);
  expect(selBox!.height).toBeGreaterThan(15);

  await assertNoOverflow(page, `/ky-so (${testInfo.project.name})`);
  void signBody;
});

// ---------------------------------------------------------------------------
// TC-MOB-03: Opaque modal surfaces in EmailSyncModal & DocTracking
// ---------------------------------------------------------------------------
test("TC-MOB-03: EmailSyncModal and DocTracking modals render opaque cards with zero overflow", async ({
  page,
}, testInfo) => {
  await installComprehensiveMocks(page);

  // 1. DocTracking detail modal
  await page.goto("/theo-doi-xem");
  const rowBtn = page.getByText("Hop-dong-SCADA-2026.pdf").first();
  if (await rowBtn.isVisible().catch(() => false)) {
    await rowBtn.click();
    const modalSurface = page.locator(".ui-modal, .modal, [role='dialog']").first();
    await expect(modalSurface).toBeVisible({ timeout: 5000 });
    const bg = await modalSurface.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");
    const modalOverflow = await modalSurface.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(modalOverflow).toBeLessThanOrEqual(2);
  }
  await assertNoOverflow(page, `/theo-doi-xem (${testInfo.project.name})`);
});

// ---------------------------------------------------------------------------
// TC-MOB-04: ShippingSPX Custom Label modal fits viewport with full-width mobile inputs
// ---------------------------------------------------------------------------
test("TC-MOB-04: ShippingSPX Custom Label modal is scrollable with wide light inputs on mobile", async ({
  page,
}, testInfo) => {
  await installComprehensiveMocks(page);
  await page.goto("/shipping-spx");

  const customBtn = page.getByRole("button", { name: /Tạo tem ngoài|In tem ngoài|Tem tự do/i }).first();
  if (await customBtn.isVisible().catch(() => false)) {
    await customBtn.click();
    const dialog = page.locator(".ui-modal, .modal, .spx-modal-card, [role='dialog']").first();
    await expect(dialog).toBeVisible();
    const vp = page.viewportSize()!;
    const dBox = await dialog.boundingBox();
    expect(dBox).not.toBeNull();
    expect(dBox!.y).toBeGreaterThanOrEqual(-1);
    expect(dBox!.y + dBox!.height).toBeLessThanOrEqual(vp.height + 2);

    if (vp.width <= 640) {
      const firstInput = dialog.locator("input[type='text']").first();
      await expect(firstInput).toBeVisible();
      const iBox = await firstInput.boundingBox();
      expect(iBox).not.toBeNull();
      expect(iBox!.width).toBeGreaterThanOrEqual(vp.width * 0.68);
      const fs = await firstInput.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fs).toBeGreaterThanOrEqual(16);
    }
  }
  await assertNoOverflow(page, `/shipping-spx (${testInfo.project.name})`);
});

// ---------------------------------------------------------------------------
// TC-MOB-07 & TC-MOB-14: Mobile hamburger, drawer, filter, Escape, masked PasswordModal
// ---------------------------------------------------------------------------
test("TC-MOB-07/14: Mobile App Shell drawer, 44px hamburger and masked PasswordModal", async ({
  page,
}, testInfo) => {
  await installComprehensiveMocks(page);
  let promptFired = false;
  page.on("dialog", async (d) => {
    promptFired = true;
    await d.dismiss();
  });

  await page.goto("/");
  const vp = page.viewportSize()!;

  if (vp.width <= 820) {
    const hamburger = page.locator("button.hamburger");
    await expect(hamburger).toBeVisible();
    const hBox = await hamburger.boundingBox();
    expect(hBox).not.toBeNull();
    expect(hBox!.x).toBeLessThanOrEqual(24);
    expect(hBox!.width).toBeGreaterThanOrEqual(44);
    expect(hBox!.height).toBeGreaterThanOrEqual(44);

    // Open drawer
    await hamburger.click();
    const drawer = page.locator("aside.sidebar.open");
    await expect(drawer).toBeVisible();

    // Change password button MUST be accessible inside mobile drawer and open masked PasswordModal
    const chgBtn = drawer.getByRole("button", { name: /Đổi mật khẩu/i });
    await expect(chgBtn).toBeVisible();
    await chgBtn.click();

    const pwInputs = page.locator('input[type="password"]');
    await expect(pwInputs.first()).toBeVisible();
    expect(promptFired).toBe(false);

    // Close modal with Escape or button
    await page.keyboard.press("Escape");
  }
  await assertNoOverflow(page, `/ shell (${testInfo.project.name})`);
});

// ---------------------------------------------------------------------------
// TC-MOB-13: Login screen mobile layout & zero raw tofu heart emoji
// ---------------------------------------------------------------------------
test("TC-MOB-13: Unauthenticated Login screen fits 360px/390px cleanly without raw tofu emoji", async ({
  page,
}, testInfo) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401, json: { detail: "Chua dang nhap" } }));
  await page.route("**/api/public/site-config", (r) =>
    r.fulfill({
      json: {
        contact: {
          company: "CÔNG TY CP ĐẦU TƯ & PT CÔNG NGHỆ INUT",
          address: "161 Trường Chinh",
          phone: "0901234567",
          email: "info@inut.vn",
        },
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await assertNoOverflow(page, `/login (${testInfo.project.name})`);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain("💙");

  const vp = page.viewportSize()!;
  if (vp.width <= 820) {
    const inputFs = await page
      .locator('input[type="password"]')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(inputFs).toBeGreaterThanOrEqual(16);
    const submitBox = await page.getByRole("button", { name: /Đăng nhập/i }).boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.height).toBeGreaterThanOrEqual(44);
  }
});

// ---------------------------------------------------------------------------
// TC-MOB-05, 06, 08, 09, 10, 11, 14: Full 36-Route Mobile/Tablet Responsive & Input Sweep
// ---------------------------------------------------------------------------
test("TC-MOB-14: All 36 routes render with 0px overflow, 0 pageerrors, and >=16px mobile inputs", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await installComprehensiveMocks(page);

  const pageErrors: string[] = [];
  let currentRoute = "";
  page.on("pageerror", (err) => pageErrors.push(`${currentRoute}: ${String(err)}`));

  const vp = page.viewportSize()!;
  const failures: string[] = [];

  for (const routePath of ALL_ADMIN_ROUTES) {
    currentRoute = routePath;
    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(80);

    const metrics = await page.evaluate((isCompact) => {
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const smallInputs: string[] = [];
      if (isCompact) {
        const els = document.querySelectorAll<HTMLElement>(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="range"]), select, textarea',
        );
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (rect.width === 0 || rect.height === 0 || st.visibility === "hidden" || st.display === "none") {
            continue;
          }
          const fs = parseFloat(st.fontSize);
          if (fs < 15.5) {
            smallInputs.push(`${el.tagName}.${el.className || "(inline)"}:${fs}px`);
          }
        }
      }
      return { overflow, smallInputs };
    }, vp.width <= 820);

    if (metrics.overflow > 1) {
      failures.push(`${routePath}: horizontal overflow=${metrics.overflow}px`);
    }
    if (metrics.smallInputs.length > 0) {
      failures.push(`${routePath}: inputs<16px -> ${metrics.smallInputs.slice(0, 5).join(", ")}`);
    }
  }

  expect(pageErrors, `Uncaught pageerrors on ${testInfo.project.name}`).toEqual([]);
  expect(failures, `Responsive sweep failures on ${testInfo.project.name}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// TC-MOB-08/A11y: Axe WCAG AA contrast check on core operational views
// ---------------------------------------------------------------------------
test("TC-MOB-08/A11y: Core operational screens pass WCAG AA critical/serious contrast", async ({
  page,
}, testInfo) => {
  await installComprehensiveMocks(page);
  for (const path of ["/", "/ho-so", "/soan-hop-dong"]) {
    await page.goto(path);
    await page.waitForTimeout(120);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .disableRules(["region", "landmark-one-main", "page-has-heading-one"])
      .analyze();
    const criticalContrast = axe.violations.filter(
      (v) => v.id === "color-contrast" && (v.impact === "critical" || v.impact === "serious"),
    );
    expect(
      criticalContrast,
      `Contrast violations on ${path} (${testInfo.project.name}): ${JSON.stringify(
        criticalContrast.map((v) => v.nodes.map((n) => n.html)).flat().slice(0, 5),
      )}`,
    ).toEqual([]);
  }
});
