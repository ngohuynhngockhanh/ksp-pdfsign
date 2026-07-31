import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("admin creates a customer-safe GHI_TAM delivery bundle", async ({ page }) => {
  let deliveryBody: Record<string, unknown> | null = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: false, must_change_password: false,
    }});
    if (path === "/api/inv/ihoadon/dashboard") return route.fulfill({ json: {
      connected: true, account_name: "INUT", tax_code: "4401053694",
      total: 20, draft: 2, issued: 18, waiting: 0, web_url: "https://example.test/ihoadon",
    }});
    if (path === "/api/inv/ihoadon/drafts" && request.method() === "GET") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/inv/availability") return route.fulfill({ json: { rows: [] } });
    if (path === "/api/inv/items") return route.fulfill({ json: [] });
    if (path === "/api/tax/policy") return route.fulfill({ json: {
      date: "2026-07-28", standard_eligible_rate: 8, reduction_to: "2026-12-31", legal_basis: ["Nghị định 174/2025/NĐ-CP"],
    }});
    if (path === "/api/inv/ihoadon/drafts/deliver") {
      deliveryBody = request.postDataJSON();
      return route.fulfill({ json: {
        draft_id: "draft-1", status: "GHI_TAM", template_code: "1", invoice_series: "C26TPK",
        document_id: 9, customer_id: 3, share_token: "public-draft", share_url: "https://example.test/s/public-draft",
        share_expires_at: "2026-08-04T10:00:00+07:00", zip_url: "/api/inv/ihoadon/deliveries/bundle.zip",
        zip_filename: "hoa-don-nhap-baotoantech-2026-07-28.zip", web_url: "https://example.test/ihoadon", stock_warnings: [],
      }});
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/tao-hoa-don-nhap");
  await page.getByLabel("Tên khách hàng").fill("CÔNG TY BẢO TOÀN");
  await page.getByLabel("Mã số thuế").fill("0314360282");
  await page.getByLabel("Địa chỉ").fill("TP.HCM");
  await page.getByPlaceholder("gõ ≥2 ký tự để tìm mã kho…").fill("iNut Smartcity - Data Logger");
  await page.locator("table tbody input[type=checkbox]").first().check();
  await page.getByLabel("Ngày dự kiến xuất").fill("2026-07-28");
  await page.getByRole("button", { name: "Tạo nháp & lấy link gửi khách" }).click();

  await expect(page.getByText("GHI_TAM · 1/C26TPK")).toBeVisible();
  await expect(page.getByRole("link", { name: "Xem PDF" })).toHaveAttribute("href", "https://example.test/s/public-draft");
  await expect(page.getByRole("link", { name: "Tải ZIP" })).toHaveAttribute("download", "hoa-don-nhap-baotoantech-2026-07-28.zip");
  expect(deliveryBody).toMatchObject({ expected_issue_date: "2026-07-28", share_days: 7 });
  expect((deliveryBody as { lines: { ten: string }[] }).lines[0].ten).toBe("iNut Smartcity - Data Logger");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const accessibility = await new AxeBuilder({ page }).include(".sale-draft-studio").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("admin syncs a corrected PYMID draft into the existing CRM record", async ({ page }) => {
  let syncCalls = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: false, must_change_password: false,
    }});
    if (path === "/api/inv/ihoadon/dashboard") return route.fulfill({ json: {
      connected: true, account_name: "INUT", tax_code: "4401053694",
      total: 20, draft: 1, issued: 19, waiting: 0, web_url: "https://example.test/ihoadon",
    }});
    if (path === "/api/inv/ihoadon/drafts" && request.method() === "GET") {
      return route.fulfill({ json: { items: [{
        id: "pymid-draft-1", other_id: null, customer_name: "CÔNG TY TNHH PYMID",
        buyer_tax_code: "0313610275", total_payment: 4321080,
        created_at: "2026-07-30T11:43:21+07:00", template_code: "1",
        invoice_series: "C26TPK", status: "GHI_TAM",
      }], total: 1 } });
    }
    if (path === "/api/inv/ihoadon/drafts/pymid-draft-1/sync-to-crm") {
      syncCalls += 1;
      return route.fulfill({ json: {
        document_id: 22, customer_id: 9, share_url: "https://example.test/s/pymid-existing",
        synced_at: "2026-07-31T12:30:00+07:00",
        checks: { customer_name: true, buyer_tax_code: true, buyer_address: true, total_payment_in_word: true },
      }});
    }
    if (path === "/api/inv/availability") return route.fulfill({ json: { rows: [] } });
    if (path === "/api/inv/items") return route.fulfill({ json: [] });
    if (path === "/api/tax/policy") return route.fulfill({ json: {
      date: "2026-07-31", standard_eligible_rate: 8, reduction_to: "2026-12-31", legal_basis: [],
    }});
    return route.fulfill({ json: {} });
  });

  await page.goto("/tao-hoa-don-nhap");
  await page.getByText("Hóa đơn ghi tạm trên iHOADON (1 bản mới nhất)").click();
  await page.getByRole("button", { name: "Đồng bộ vào hồ sơ" }).click();

  expect(syncCalls).toBe(1);
  await expect(page.getByText("Đã đồng bộ bản nháp PYMID vào hồ sơ CRM.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Mở PDF trong CRM" })).toHaveAttribute(
    "href", "https://example.test/s/pymid-existing",
  );
});
