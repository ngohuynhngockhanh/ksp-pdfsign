import { expect, test } from "@playwright/test";

test("security warnings live in settings instead of covering every page", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: true, must_change_password: true,
    }});
    if (path === "/api/settings") return route.fulfill({ json: {
      ai_enabled: false, ai_base_url: "", ai_api_key_set: false, ai_model: "", ai_max_tokens: 0, ai_timeout: 30,
      nas_enabled: false, nas_host: "", nas_share: "", nas_user: "", nas_password_set: false, nas_base_path: "", nas_timeout: 10,
      ihoadon_enabled: false, ihoadon_base_url: "", ihoadon_tax_code: "", ihoadon_username: "", ihoadon_password_set: false, ihoadon_timeout: 30,
      smtp_host: "", smtp_port: 587, smtp_username: "", smtp_password_set: false, smtp_from: "", smtp_to: "",
    }});
    if (path === "/api/ihoadon/customer-sync/status") return route.fulfill({ json: { job: null, total: 0, unmatched: 0 } });
    if (path === "/api/ihoadon/customer-invoices/unmatched") return route.fulfill({ json: [] });
    if (path === "/api/customers") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  await page.goto("/");
  await expect(page.getByText("Đang dùng mật khẩu/khóa mặc định", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Tài khoản đang dùng mật khẩu tạm", { exact: false })).toHaveCount(0);

  await page.goto("/cai-dat");
  const security = page.getByRole("region", { name: "Bảo mật tài khoản và khóa hệ thống" });
  await expect(security).toContainText("Mật khẩu/khóa mặc định");
  await expect(security).toContainText("Mật khẩu tạm");
  await expect(security.getByRole("button", { name: "Đổi mật khẩu tài khoản" })).toBeVisible();
});
