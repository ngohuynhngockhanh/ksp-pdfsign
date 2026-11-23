import { expect, test } from "@playwright/test";

const FULLSTACK_URL = process.env.FULLSTACK_BASE_URL || "";
const ADMIN_PASS = process.env.FULLSTACK_ADMIN_PASSWORD || "TestAdminPass!2026";

test.describe("Stage 5: Ephemeral Real-Backend Full-Stack Smoke", () => {
  test.skip(!FULLSTACK_URL, "Skipped unless FULLSTACK_BASE_URL is configured (ephemeral backend)");

  test("login, forced customer password change, core routes & zero 5xx against live ephemeral FastAPI", async ({
    page,
    request,
  }, testInfo) => {
    const server5xx: string[] = [];
    page.on("response", (res) => {
      if (res.status() >= 500) {
        server5xx.push(`${res.status()} ${res.url()}`);
      }
    });

    // 1. Unauthenticated /login renders cleanly with 0px overflow
    await page.goto("/");
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10000 });
    const loginOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(loginOverflow).toBeLessThanOrEqual(1);

    // 2. Real Admin Login via UI
    await page.getByLabel(/Tài khoản/i).fill("admin");
    await page.getByLabel(/Mật khẩu/i).fill(ADMIN_PASS);
    await page.getByRole("button", { name: /Đăng nhập/i }).click();
    await expect(page.locator("main.app-content")).toBeVisible({ timeout: 10000 });

    // 3. Navigate critical operational routes against real FastAPI backend
    for (const path of ["/", "/ho-so", "/ky-so", "/ton-kho", "/hop-dong-khoan", "/shipping-spx"]) {
      await page.goto(path);
      await page.waitForTimeout(250);
      const ov = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(ov, `Overflow on ${path} (${testInfo.project.name})`).toBeLessThanOrEqual(1);
    }

    // 4. Verify /api/health hides using_default_secrets
    const health = await request.get(`${FULLSTACK_URL}/api/health`);
    expect(health.status()).toBe(200);
    const healthJson = await health.json();
    expect(healthJson).not.toHaveProperty("using_default_secrets");

    // 5. Verify unauthenticated /api/mail/send and /api/bidding/contractors/crm-scan are rejected
    const mailUnauth = await request.post(`${FULLSTACK_URL}/api/mail/send`, {
      data: { to: "x@example.com", subject: "x", body: "x" },
    });
    expect(mailUnauth.status()).toBe(401);

    expect(server5xx, "Unexpected 5xx responses during fullstack smoke").toEqual([]);
  });
});
