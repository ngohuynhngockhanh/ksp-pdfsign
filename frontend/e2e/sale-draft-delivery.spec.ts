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
  await page.getByPlaceholder("gõ ≥2 ký tự để tìm mã kho…").fill("iNut Smartcity - Data Logger");
  await page.getByText("DV", { exact: true }).getByRole("checkbox").check();
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
