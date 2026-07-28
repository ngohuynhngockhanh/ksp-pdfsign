import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("PYMID cấu hình Nebi, lưu nháp và gửi INUT duyệt", async ({ page }) => {
  let orders: any[] = [];
  const items = [
    { id: 1, code: "PMC01", name: "Bộ Trung Tâm PYMID CENTER Level 1", unit: "Cái", source_price: 2455000, category: "hardware", level: 1, net_price: 2614120, tax_amount: 209130, gross_price: 2823250, vat_rate: 8, vat_label: "VAT 8%", tax_treatment: "taxable" },
    { id: 2, code: "RS485-RELAY4", name: "Mạch RS485 4 Relay", unit: "Cái", source_price: 550000, category: "hardware", level: null, net_price: 585648, tax_amount: 46852, gross_price: 632500, vat_rate: 8, vat_label: "VAT 8%", tax_treatment: "taxable" },
    { id: 3, code: "SW-PHUN-SUONG", name: "Phần mềm điều khiển phun sương", unit: "Gói", source_price: 550000, category: "software", level: null, net_price: 632500, tax_amount: 0, gross_price: 632500, vat_rate: null, vat_label: "KCT", tax_treatment: "exempt" },
  ];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return route.fulfill({ json: { username: "pymid", role: "customer", customer_id: 9, customer_name: "CÔNG TY TNHH PYMID", agent_default_ip: "", default_location: "", using_default_secrets: false, must_change_password: false, training_access: false } });
    if (url.pathname === "/api/pymid/catalog") return route.fulfill({ json: { policy: { code: "NQ204_2025_VAT8", vat_rate: 8, label: "VAT 8%", valid_to: "2026-12-31" }, items } });
    if (url.pathname === "/api/pymid/orders" && route.request().method() === "GET") return route.fulfill({ json: orders });
    if (url.pathname === "/api/pymid/orders" && route.request().method() === "POST") {
      orders = [{ id: 7, level: 1, status: "draft", document_date: "2026-07-29", customer_reference: "Nhà yến Hòa Bình", note: "", policy_code: "NQ204_2025_VAT8", items: [{ ...items[0], product_id: 1, quantity: 1, net_amount: 2614120, gross_amount: 2823250 }, { ...items[1], product_id: 2, quantity: 2, net_amount: 1171296, gross_amount: 1265000 }, { ...items[2], product_id: 3, quantity: 1, net_amount: 632500, gross_amount: 632500 }], invoice_lines: [{ name: "iNut Nebi - Bộ giải pháp nhà yến", unit: "Bộ", quantity: 1, tax_treatment: "taxable", vat_rate: 8, vat_label: "VAT 8%", net_amount: 3200000, tax_amount: 256000, gross_amount: 3456000 }, { name: "iNut Nebi Software: License Phun sương", unit: "Gói", quantity: 1, tax_treatment: "exempt", vat_rate: null, vat_label: "KCT", net_amount: 632500, tax_amount: 0, gross_amount: 632500 }], total_net: 3832500, total_tax: 256000, total_gross: 4088500, created_at: "", updated_at: "" }];
      return route.fulfill({ json: orders[0] });
    }
    if (url.pathname === "/api/pymid/orders/7" && route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      orders[0] = { ...orders[0], customer_reference: body.customer_reference };
      return route.fulfill({ json: orders[0] });
    }
    if (url.pathname === "/api/pymid/orders/7/submit") { orders[0].status = "submitted"; return route.fulfill({ json: orders[0] }); }
    if (url.pathname === "/api/pymid/orders/7/xlsx") return route.fulfill({ body: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    return route.fulfill({ json: {} });
  });

  await page.goto("/pymid-coop");
  await expect(page.getByRole("heading", { name: "INUT – PYMID CO.OP" })).toBeVisible();
  await expect(page.getByText("VAT 8% đến 31/12/2026")).toBeVisible();
  await page.getByLabel("Mạch RS485 4 Relay").fill("2");
  await page.getByLabel("Phần mềm điều khiển phun sương").fill("1");
  await page.getByLabel("Tham chiếu công trình").fill("Nhà yến Hòa Bình");
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(page.getByText("Đã lưu đơn nháp #7")).toBeVisible();
  await expect(page.getByText("iNut Nebi Software: License Phun sương")).toBeVisible();
  await page.getByRole("button", { name: "Sửa nháp" }).click();
  await page.getByLabel("Tham chiếu công trình").fill("Nhà yến Hòa Bình - đã sửa");
  await page.getByRole("button", { name: "Cập nhật nháp" }).click();
  await expect(page.getByText("Đã cập nhật đơn nháp #7")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tải danh mục giá" })).toBeVisible();
  await page.getByRole("button", { name: "Gửi INUT duyệt" }).click();
  await expect(page.getByText("Đã gửi INUT duyệt")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tải Excel" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const accessibility = await new AxeBuilder({ page }).include(".pymid-coop-page").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
