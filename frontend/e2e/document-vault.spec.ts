import { expect, test } from "@playwright/test";

test("document vault keeps classification actions inside a clearer workspace", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: false, must_change_password: false,
    }});
    if (path === "/api/documents") return route.fulfill({ json: { total: 2, page: 1, per_page: 20, items: [
      { id: 1, doc_id: "a", filename: "Hop-dong-demo.pdf", signer_name: "INUT", signed: false, note: "", customer_id: 7, customer_name: "CÔNG TY DEMO", created_at: "2026-07-31T08:00:00Z", download_url: "/api/documents/1/download", nas_synced: true, doc_type: "hop_dong", signed_upload_name: "Hop-dong-demo-signed.pdf", order_id: null, order_code: "" },
      { id: 2, doc_id: "b", filename: "Tai-lieu-chua-phan-loai.pdf", signer_name: "", signed: false, note: "", customer_id: null, customer_name: null, created_at: "2026-07-30T08:00:00Z", download_url: "/api/documents/2/download", nas_synced: false, doc_type: "khac", signed_upload_name: "", order_id: null, order_code: "" },
    ] } });
    if (path === "/api/customers") return route.fulfill({ json: [{ id: 7, name: "CÔNG TY DEMO", tax_code: "0312345688", contact: "", address: "", email: "", logo_url: "", note: "", created_at: "", document_count: 1, account_usernames: [], aliases: [] }] });
    if (path === "/api/orders") return route.fulfill({ json: [] });
    if (path === "/api/nas/status") return route.fulfill({ json: { enabled: true, host: "nas.local", share: "hoso", synced: 1, total: 2, pending: 1 } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/ho-so");

  await expect(page.getByRole("heading", { name: "Kho hồ sơ vận hành." })).toBeVisible();
  await expect(page.getByText("2 hồ sơ", { exact: true })).toBeVisible();
  await expect(page.getByText("1 chưa phân loại", { exact: true })).toBeVisible();
  await expect(page.getByText("Hop-dong-demo.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ phân loại" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
