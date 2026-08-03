import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    username: "admin", role: "admin", customer_name: null,
    agent_default_ip: "", default_location: "", using_default_secrets: false,
    must_change_password: false,
  }}));
  await page.route("**/api/operations/dashboard", (route) => route.fulfill({ json: {
    purchases: 12, purchase_drafts: 2, sales: 8, sale_drafts: 1,
    documents: { missing: 1, renderable: 2, source_only: 0, ready: 17 },
    document_queue: [], latest_report: null,
    latest_sync: {
      id: 7, kind: "tax_sync", status: "needs_action",
      period_from: "2026-07-01", period_to: "2026-07-31", stats: {},
      error: "Phiên cổng thuế hết hạn; cần nhập captcha lại trong CRM",
      needs_action: true, started_at: "2026-07-31T08:00:00Z", finished_at: null,
    },
  }}));
  await page.route("**/api/tax/reports", (route) => route.fulfill({ json: [] }));
});

test("tax login warning stays readable and actionable on mobile", async ({ page }, testInfo) => {
  await page.goto("/");

  const alert = page.getByRole("button", { name: /Cần đăng nhập lại cổng thuế/ });
  const action = alert.getByText("Mở xử lý", { exact: false });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Phiên cổng thuế hết hạn; cần nhập captcha lại trong CRM");

  if (testInfo.project.name === "mobile") {
    const [alertBox, actionBox] = await Promise.all([alert.boundingBox(), action.boundingBox()]);
    expect(alertBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.width).toBeGreaterThan(alertBox!.width * 0.7);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }

  await alert.click();
  await expect(page).toHaveURL(/\/dong-bo-thue$/);
});
