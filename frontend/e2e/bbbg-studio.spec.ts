import { expect, test } from "@playwright/test";

test("AI-first handover studio keeps invoice parsing and editing usable", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: false, must_change_password: false,
    }});
    if (path === "/api/bbbg/templates") return route.fulfill({ json: { templates: [{ key: "bbbg_thiet_bi", label: "Bàn giao thiết bị" }] } });
    if (path === "/api/inv/availability") return route.fulfill({ json: { rows: [{ ten: "Gateway iNut", kha_dung: 5, ton: 5, dvt: "Bộ" }] } });
    if (path === "/api/invoice/parse") return route.fulfill({ json: {
      buyer: { name: "CÔNG TY DEMO", address: "Đắk Lắk", mst: "4400000000", email: "demo@example.test" },
      items: [{ stt: 1, ten: "Gateway iNut", dvt: "Bộ", so_luong: "2" }],
      ngay: { day: 31, month: 7, year: 2026 }, ky_hieu: "AA/26E", raw_text: "",
      suggested_customer: { id: 9, name: "CÔNG TY DEMO" }, products_learned: 0,
    }});
    return route.fulfill({ json: {} });
  });

  await page.goto("/tao-bbbg");

  await expect(page.getByRole("heading", { name: "Biên bản bàn giao, từ hóa đơn đến bản ký." })).toBeVisible();
  await expect(page.getByText("AI đọc hóa đơn")).toBeVisible();
  await expect(page.getByText("Kiểm tra dữ liệu")).toBeVisible();
  await expect(page.getByText("Sinh PDF & ký")).toBeVisible();

  await page.getByLabel("Hóa đơn nguồn").setInputFiles({
    name: "hoa-don.xml", mimeType: "application/xml", buffer: Buffer.from("<invoice />"),
  });
  await expect(page.getByLabel("Tên đơn vị")).toHaveValue("CÔNG TY DEMO");
  await expect(page.getByLabel("Mã số thuế")).toHaveValue("4400000000");
  await expect(page.locator('input[value="Gateway iNut"]')).toBeVisible();
  await expect(page.getByText("Sẵn sàng tạo biên bản")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
