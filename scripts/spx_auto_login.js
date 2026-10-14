#!/usr/bin/env node
/**
 * Automated Headless Chromium Login for SPX Express (spx.vn)
 * Uses local Playwright runtime from frontend/node_modules/playwright.
 *
 * Usage:
 *   node scripts/spx_auto_login.js <username> <password>
 *   or via env SPX_USERNAME / SPX_PASSWORD
 */

const path = require("path");

const PLAYWRIGHT_PATH = path.resolve(
  __dirname,
  "../frontend/node_modules/playwright"
);
const { chromium } = require(PLAYWRIGHT_PATH);

const LOGIN_URL =
  "https://account.spx.vn/authenticate/login?next=https%3A%2F%2Fspx.vn%2Fshipment%2Faccount%2Fapi%2Flogin%3Fredirect%3Dhttps%253A%252F%252Fspx.vn%252Fspx-admin%252Forder%252Ftrackings&client_id=2&should_hide_back=true&lang=vi";

async function main() {
  const username = (process.argv[2] || process.env.SPX_USERNAME || "").trim();
  const password = (process.argv[3] || process.env.SPX_PASSWORD || "").trim();

  if (!username || !password) {
    console.log(
      JSON.stringify({
        success: false,
        error: "Missing SPX username or password",
      })
    );
    process.exit(1);
  }

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    await page.goto(LOGIN_URL, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    const userLocator = page
      .locator(
        'input[placeholder*="SĐT"], input[placeholder*="Email"], input[type="text"]'
      )
      .first();
    await userLocator.waitFor({ state: "visible", timeout: 15000 });
    await userLocator.fill(username);

    const passLocator = page.locator('input[type="password"]').first();
    await passLocator.waitFor({ state: "visible", timeout: 15000 });
    await passLocator.fill(password);

    const submitBtn = page
      .locator('button:has-text("Đăng nhập"), button[type="submit"]')
      .first();
    await submitBtn.click();

    await page.waitForURL("**/spx-admin/**", { timeout: 25000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    const cookies = await context.cookies(["https://spx.vn", "https://account.spx.vn"]);
    const cookieMap = {};
    for (const c of cookies) {
      cookieMap[c.name] = c.value;
    }

    if (!cookieMap.spx_token || !cookieMap.spx_sid) {
      throw new Error(
        `Login redirected to ${page.url()} but spx_token or spx_sid cookie was not found.`
      );
    }

    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    console.log(
      JSON.stringify({
        success: true,
        cookies: cookieStr,
        spx_token: cookieMap.spx_token,
        spx_sid: cookieMap.spx_sid,
        url: page.url(),
      })
    );
    await browser.close();
    process.exit(0);
  } catch (err) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    console.log(
      JSON.stringify({
        success: false,
        error: err && err.message ? err.message : String(err),
      })
    );
    process.exit(1);
  }
}

main();
