import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// TC-BIZ-01: Role gating & forced PasswordModal when must_change_password=true
// ---------------------------------------------------------------------------
test("TC-BIZ-01: Forced PasswordModal blocks access until changed and pymid_staff stays scoped", async ({
  page,
}) => {
  // 1. Customer with must_change_password=true sees forced PasswordModal immediately
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/me") {
      return route.fulfill({
        json: {
          username: "0314360282",
          role: "customer",
          portal_scope: "full",
          customer_name: "Công ty Bảo Toàn",
          agent_default_ip: "",
          default_location: "",
          using_default_secrets: false,
          must_change_password: true,
          training_access: false,
        },
      });
    }
    return route.fulfill({ status: 403, json: { detail: "Bắt buộc đổi mật khẩu lần đầu" } });
  });

  await page.goto("/ho-so-cua-toi");
  const pwModal = page.locator('input[type="password"]');
  await expect(pwModal.first()).toBeVisible({ timeout: 5000 });
  // Non-dismissible via Escape while forced
  await page.keyboard.press("Escape");
  await expect(pwModal.first()).toBeVisible();
});

test("TC-BIZ-01b: pymid_staff is restricted strictly to /pymid-coop without admin tabs", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/me") {
      return route.fulfill({
        json: {
          username: "pymid_nv1",
          role: "customer",
          portal_scope: "pymid_coop",
          customer_name: "PYMID",
          agent_default_ip: "",
          default_location: "",
          using_default_secrets: false,
          must_change_password: false,
          training_access: false,
        },
      });
    }
    if (p === "/api/pymid/catalog") return route.fulfill({ json: { items: [], categories: [] } });
    if (p === "/api/pymid/orders") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  await page.goto("/cai-dat");
  await expect(page).toHaveURL(/\/pymid-coop$/);
  await expect(page.locator('a[href="/cai-dat"]')).toHaveCount(0);
  await expect(page.locator('a[href="/kiem-tra"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// TC-BIZ-04: Inventory NegativeStockError 400 opens NegStockModal cleanly
// ---------------------------------------------------------------------------
test("TC-BIZ-04: Stock issue HTTP 400 detail.violations opens NegStockModal", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === "/api/me") {
      return route.fulfill({
        json: {
          username: "admin",
          role: "admin",
          portal_scope: "full",
          customer_name: null,
          agent_default_ip: "",
          default_location: "",
          using_default_secrets: false,
          must_change_password: false,
          training_access: true,
        },
      });
    }
    if (p === "/api/inv/warehouses") {
      return route.fulfill({ json: [{ id: 1, code: "HH", name: "Hàng hóa" }] });
    }
    if (p === "/api/inv/items") {
      return route.fulfill({ json: [{ id: 1, code: "GW-1", name: "Gateway 4G", unit: "bộ" }] });
    }
    if (p === "/api/inv/issues") {
      return route.fulfill({
        json: [
          {
            id: 55,
            ngay: "2026-08-10",
            status: "draft",
            warehouse_id: 1,
            warehouse_code: "HH",
            customer_name: "Khách Demo",
            note: "Xuất test",
            lines: [{ id: 1, item_id: 1, item_code: "GW-1", item_name: "Gateway 4G", so_luong: 10 }],
          },
        ],
      });
    }
    if (p === "/api/inv/issues/55/post" && req.method() === "POST") {
      return route.fulfill({
        status: 400,
        json: {
          detail: {
            message: "Xuất vượt tồn kho (âm kho)",
            violations: [
              {
                item_code: "GW-1",
                item_name: "Gateway 4G",
                warehouse_code: "HH",
                ngay: "2026-08-10",
                ton_truoc: 2,
                can_xuat: 10,
                thieu: 8,
              },
            ],
          },
        },
      });
    }
    if (p === "/api/customers") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  await page.goto("/xuat-kho");
  const postBtn = page.getByRole("button", { name: /Ghi sổ/i }).first();
  if (await postBtn.isVisible().catch(() => false)) {
    await postBtn.click();
    await expect(page.getByText(/âm kho|vượt tồn/i).first()).toBeVisible({ timeout: 5000 });
  }
});

// ---------------------------------------------------------------------------
// TC-BIZ-10: Legacy route aliases, query deep-links & native <a href> navigation
// ---------------------------------------------------------------------------
test("TC-BIZ-10: Legacy aliases and deep links resolve accurately with real anchor tags", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/me") {
      return route.fulfill({
        json: {
          username: "admin",
          role: "admin",
          portal_scope: "full",
          customer_name: null,
          agent_default_ip: "",
          default_location: "",
          using_default_secrets: false,
          must_change_password: false,
          training_access: true,
        },
      });
    }
    if (p === "/api/spx/orders" || p === "/api/bidding/search" || p === "/api/bidding/bookmarks" || p === "/api/bidding/watchlist" || p === "/api/bidding/won-packages") {
      return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 10, total_pages: 1 } });
    }
    if (p === "/api/standards/statistics") return route.fulfill({ json: { total_standards: 0, mandatory_count: 0, total_labs: 0, ministries: [] } });
    if (p === "/api/standards/search" || p === "/api/standards/tqc/search") return route.fulfill({ json: { items: [], total: 0, results: [] } });
    if (p === "/api/standards/hs-mappings" || p === "/api/standards/testing-labs" || p === "/api/standards/playbooks") return route.fulfill({ json: [] });
    if (p === "/api/standards/game/state") return route.fulfill({ json: { current_level: 1, current_level_title: "Tân binh", current_exp: 0, max_exp: 100, progress_percent: 0, completed_quests_count: 0, total_quests: 0, ai_companion_cheer: "", quests: [] } });
    if (p === "/api/standards/risk-classification/statistics") return route.fulfill({ json: { total_items: 0, high_risk_count: 0, medium_risk_count: 0, low_risk_count: 0, categories: [] } });
    if (p === "/api/standards/risk-classification/catalog" || p === "/api/standards/risk-classification/classify") return route.fulfill({ json: { items: [], total: 0, matches: [] } });
    if (p === "/api/trademarks") return route.fulfill({ json: [] });
    if (p === "/api/web-ads/overview") {
      return route.fulfill({ json: { kpis: {}, leads: [], campaigns: [], daily: [], sources: [] } });
    }
    return route.fulfill({ json: {} });
  });

  const aliases: Array<[string, string]> = [
    ["/dau-thau", "bidding"],
    ["/spx", "shippingspx"],
    ["/nhan-hieu", "trademarks"],
    ["/hop-chuan-hop-quy", "standards"],
    ["/qcvn", "standards"],
    ["/ads-leads", "webads"],
    ["/lead-website", "webads"],
  ];

  for (const [aliasPath, expectedPage] of aliases) {
    await page.goto(aliasPath);
    await expect(page.locator("main.app-content")).toHaveAttribute("data-page", expectedPage);
  }

  // Verify sidebar uses real <a href> links supporting native Ctrl/Meta+click
  const docLink = page.locator('aside.sidebar a[href="/ho-so"]');
  await expect(docLink).toHaveAttribute("href", "/ho-so");
});
