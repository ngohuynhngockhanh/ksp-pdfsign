import { expect, test } from "@playwright/test";

test("NAS keeps the current folder in the URL and restores it with browser history", async ({ page }) => {
  const browsed: string[] = [];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: false, must_change_password: false,
      training_access: false,
    } });
    if (url.pathname === "/api/nas/browse") {
      const path = url.searchParams.get("path") || "";
      browsed.push(path);
      return route.fulfill({ json: {
        path,
        entries: path.endsWith("Thang 07")
          ? [{ name: "Hop-dong.pdf", is_dir: false, size: 2048 }]
          : [{ name: "Thang 07", is_dir: true, size: 0 }],
      } });
    }
    return route.fulfill({ json: {} });
  });

  const parent = "Khach hang\\Hop dong";
  const child = `${parent}\\Thang 07`;
  await page.goto(`/nas?path=${encodeURIComponent(parent)}`);

  await expect(page.getByRole("button", { name: /Thang 07/ })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/nas" && url.searchParams.get("path") === parent);

  await page.getByRole("button", { name: /Thang 07/ }).click();
  await expect(page.getByRole("button", { name: /Hop-dong\.pdf/ })).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("path") === child);

  await page.goBack();
  await expect(page.getByRole("button", { name: /Thang 07/ })).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("path") === parent);

  await page.reload();
  await expect(page.getByRole("button", { name: /Thang 07/ })).toBeVisible();
  expect(browsed).toContain(parent);
  expect(browsed).toContain(child);
});
