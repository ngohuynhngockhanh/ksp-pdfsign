import { expect, test } from "@playwright/test";

function mockTaxPage(page: import("@playwright/test").Page, sessionValid: boolean, captchaCalls: { count: number }) {
  return page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") {
      return route.fulfill({ json: {
        username: "admin", role: "admin", customer_name: null,
        agent_default_ip: "", default_location: "", using_default_secrets: false,
        must_change_password: false, training_access: false,
      }});
    }
    if (path === "/api/tax/session") {
      return route.fulfill({ json: { valid: sessionValid } });
    }
    if (path === "/api/tax/credentials") {
      return route.fulfill({ json: { mst: "4401053694", has_password: true } });
    }
    if (path === "/api/tax/captcha") {
      captchaCalls.count += 1;
      return route.fulfill({ json: { key: "captcha-key", svg: "<svg></svg>" } });
    }
    return route.fulfill({ json: {} });
  });
}

test("does not fetch a CAPTCHA while the saved tax session is valid", async ({ page }) => {
  const captchaCalls = { count: 0 };
  await mockTaxPage(page, true, captchaCalls);

  await page.goto("/dong-bo-thue");

  await expect(page.getByText("Phiên cổng thuế hiện còn hiệu lực")).toBeVisible();
  expect(captchaCalls.count).toBe(0);
});

test("fetches a fresh CAPTCHA when the saved tax session is expired", async ({ page }) => {
  const captchaCalls = { count: 0 };
  await mockTaxPage(page, false, captchaCalls);

  await page.goto("/dong-bo-thue");

  await expect(page.getByText("Phiên đã hết hạn", { exact: false })).toBeVisible();
  await expect(page.locator("svg")).toBeVisible();
  expect(captchaCalls.count).toBe(1);
});
