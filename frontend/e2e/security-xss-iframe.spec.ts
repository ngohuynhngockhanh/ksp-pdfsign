import { expect, test } from "@playwright/test";

const MOCK_ADMIN = {
  username: "admin",
  role: "admin",
  portal_scope: "full",
  customer_name: null,
  agent_default_ip: "127.0.0.1",
  default_location: "Đắk Lắk",
  using_default_secrets: false,
  must_change_password: false,
  training_access: true,
};

// ---------------------------------------------------------------------------
// TC-SEC-21a: TaxSync renders external captcha SVG via <img>, NEVER dangerouslySetInnerHTML
// ---------------------------------------------------------------------------
test("TC-SEC-21a: TaxSync renders GDT captcha SVG as safe <img> without script execution", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/me") return route.fulfill({ json: MOCK_ADMIN });
    if (p === "/api/tax/session") return route.fulfill({ json: { logged_in: false } });
    if (p === "/api/tax/captcha") {
      return route.fulfill({
        json: {
          key: "cap-key-1",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__svgXss=1"><script>window.__svgXss=1</script><text>ABC</text></svg>',
        },
      });
    }
    if (p === "/api/tax/reports") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  await page.goto("/dong-bo-thue");
  const capImg = page.locator('img[src^="data:image/svg+xml"]');
  await expect(capImg).toBeVisible({ timeout: 5000 });

  const xssTriggered = await page.evaluate(() => (window as any).__svgXss);
  expect(xssTriggered).toBeUndefined();
});

// ---------------------------------------------------------------------------
// TC-SEC-21b: HTML preview iframes carry sandbox="" while PDF iframes stay unsandboxed
// ---------------------------------------------------------------------------
test("TC-SEC-21b: Documents HTML preview uses sandbox='' while PDF preview preserves native viewer", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/me") return route.fulfill({ json: MOCK_ADMIN });
    if (p === "/api/documents") {
      return route.fulfill({
        json: {
          total: 2,
          page: 1,
          per_page: 20,
          items: [
            {
              id: 11,
              doc_id: "md11",
              filename: "bao-cao.md",
              signer_name: "",
              signed: false,
              note: "",
              customer_id: null,
              customer_name: null,
              created_at: "2026-08-01T08:00:00Z",
              download_url: "/api/documents/11/download",
              nas_synced: false,
              doc_type: "khac",
              signed_upload_name: "",
              order_id: null,
              order_code: "",
            },
            {
              id: 12,
              doc_id: "pdf12",
              filename: "hop-dong.pdf",
              signer_name: "INUT",
              signed: true,
              note: "",
              customer_id: null,
              customer_name: null,
              created_at: "2026-08-01T08:00:00Z",
              download_url: "/api/documents/12/download",
              nas_synced: true,
              doc_type: "hop_dong",
              signed_upload_name: "",
              order_id: null,
              order_code: "",
            },
          ],
        },
      });
    }
    if (p === "/api/documents/11/view") {
      return route.fulfill({ contentType: "text/html", body: "<html><body><h1>MD Preview</h1></body></html>" });
    }
    if (p === "/api/documents/12/view") {
      return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF\n" });
    }
    if (p === "/api/customers" || p === "/api/orders") return route.fulfill({ json: [] });
    if (p === "/api/nas/status") return route.fulfill({ json: { enabled: false, synced: 0, total: 2, pending: 0 } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/ho-so");

  // Open Markdown HTML preview -> iframe MUST have sandbox=""
  const mdRow = page.locator("tr, .ui-mobile-card").filter({ hasText: "bao-cao.md" }).first();
  await mdRow.getByRole("button", { name: /Xem/i }).first().click();
  const mdFrame = page.locator("iframe.doc-preview-frame");
  await expect(mdFrame).toBeVisible();
  const mdSandbox = await mdFrame.getAttribute("sandbox");
  expect(mdSandbox).toBe("");

  await page.getByRole("button", { name: /Đóng/i }).first().click();

  // Open PDF preview -> iframe MUST NOT have sandbox="" (Conflict Guard #1!)
  const pdfRow = page.locator("tr, .ui-mobile-card").filter({ hasText: "hop-dong.pdf" }).first();
  await pdfRow.getByRole("button", { name: /Xem/i }).first().click();
  const pdfFrame = page.locator("iframe.doc-preview-frame");
  await expect(pdfFrame).toBeVisible();
  const pdfSandbox = await pdfFrame.getAttribute("sandbox");
  expect(pdfSandbox).toBeNull();
});

// ---------------------------------------------------------------------------
// TC-SEC-21c: Dynamic javascript: URLs neutralized across GovRadar & Trademarks
// ---------------------------------------------------------------------------
test("TC-SEC-21c: Dynamic javascript: links are stripped in GovRadar and Trademarks", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/me") return route.fulfill({ json: MOCK_ADMIN });
    if (p === "/api/gov-radar") {
      return route.fulfill({
        json: {
          items: [
            {
              id: 1,
              title: "Công văn test XSS URL",
              doc_number: "999/CV-TEST",
              source: "daklak.gov.vn",
              source_url: "javascript:alert(1)",
              pdf_url: "javascript:alert(2)",
              issued_date: "2026-08-01",
              priority: "high",
              acked: false,
            },
          ],
          total: 1,
          stats: { total: 1, urgent: 1, unread: 1 },
        },
      });
    }
    if (p === "/api/trademarks") {
      return route.fulfill({
        json: [
          {
            id: 1,
            application_number: "4-2024-00001",
            registration_number: "456789",
            mark_name: "INUT-TEST",
            owner_name: "INUT",
            status: "registered",
            filing_date: "2024-01-01",
            expiry_date: "2034-01-01",
            source_url: "javascript:alert(3)",
            nice_classes: ["9", "42"],
          },
        ],
      });
    }
    return route.fulfill({ json: {} });
  });

  for (const path of ["/cong-van-chinh-phu", "/trademarks"]) {
    await page.goto(path);
    await page.waitForTimeout(150);
    const jsLinks = await page.locator('a[href^="javascript:" i]').count();
    expect(jsLinks, `Found javascript: href on ${path}`).toBe(0);
  }
});
