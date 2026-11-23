#!/usr/bin/env node
/**
 * Automated Headless Chromium Login for SPX Express (spx.vn)
 * Uses local Playwright runtime from frontend/node_modules/playwright.
 *
 * Credentials input priority (preferred -> deprecated):
 *   1) Environment variables: SPX_USERNAME / SPX_PASSWORD
 *   2) Piped JSON on stdin:   {"username":"...","password":"..."}
 *   3) Deprecated positional CLI args (emits warning to stderr)
 *
 * Output:
 *   - By default, emits redacted login metadata only (never raw tokens/cookies).
 *   - Pass `--json-output` (or env `SPX_JSON_OUTPUT=1`) for programmatic callers
 *     that require `{success, cookies, spx_token, spx_sid, url}` on stdout.
 */

const path = require("path");

const PLAYWRIGHT_PATH = path.resolve(
  __dirname,
  "../frontend/node_modules/playwright"
);
const { chromium } = require(PLAYWRIGHT_PATH);

const LOGIN_URL =
  "https://account.spx.vn/authenticate/login?next=https%3A%2F%2Fspx.vn%2Fshipment%2Faccount%2Fapi%2Flogin%3Fredirect%3Dhttps%253A%252F%252Fspx.vn%252Fspx-admin%252Forder%252Ftrackings&client_id=2&should_hide_back=true&lang=vi";

function readStdinJson() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 65536) process.stdin.destroy();
    });
    process.stdin.on("end", () => {
      const trimmed = raw.trim();
      if (!trimmed) return resolve({});
      try {
        const parsed = JSON.parse(trimmed);
        return resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        return resolve({});
      }
    });
    process.stdin.on("error", () => resolve({}));
  });
}

async function resolveCredentials() {
  const args = process.argv.slice(2);
  const jsonOutput =
    args.includes("--json-output") || process.env.SPX_JSON_OUTPUT === "1";
  const positional = args.filter((a) => !a.startsWith("--"));

  let username = (process.env.SPX_USERNAME || "").trim();
  let password = (process.env.SPX_PASSWORD || "").trim();

  if (!username || !password) {
    const stdinData = await readStdinJson();
    username = username || String(stdinData.username || "").trim();
    password = password || String(stdinData.password || "").trim();
  }

  if ((!username || !password) && positional.length >= 2) {
    console.error(
      "[DEPRECATION] Passing SPX credentials via CLI argv is insecure; use SPX_USERNAME/SPX_PASSWORD env or JSON stdin."
    );
    username = username || positional[0].trim();
    password = password || positional[1].trim();
  }

  return { username, password, jsonOutput };
}

async function main() {
  const { username, password, jsonOutput } = await resolveCredentials();

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
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
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
    await page.waitForTimeout(2000);

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
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          success: true,
          cookies: cookieStr,
          spx_token: cookieMap.spx_token,
          spx_sid: cookieMap.spx_sid,
          url: page.url(),
        })
      );
    } else {
      console.log(
        JSON.stringify({
          success: true,
          url: page.url(),
          cookie_count: cookies.length,
          has_spx_token: true,
          has_spx_sid: true,
          note: "Raw tokens/cookies omitted; pass --json-output for programmatic consumption.",
        })
      );
    }
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
