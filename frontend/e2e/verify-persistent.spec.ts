import { expect, test } from "@playwright/test";

test("đường dẫn kiểm tra chữ ký giữ nguyên hồ sơ sau khi tải lại", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: { username: "admin", role: "admin", customer_id: null, customer_name: null, agent_default_ip: "", default_location: "Đắk Lắk", using_default_secrets: false, must_change_password: false, training_access: false } });
    if (path === "/api/documents/18/verify") return route.fulfill({ json: { doc_id: "signed", signature_count: 1, signatures: [{ field_name: "Signature1", signer_name: "INUT", signing_time: "2026-07-29T12:00:00+07:00", certificate_issuer: "WINCA", certificate_valid_from: "2024-04-27T15:58:13+07:00", certificate_valid_to: "2027-06-15T15:47:23+07:00", intact: true, valid: true, trusted: true, revocation_ok: true, has_timestamp: false, ltv: null, coverage: "Ký toàn bộ tài liệu", summary: "HỢP LỆ", problems: [] }] } });
    if (path === "/api/documents/18/download") return route.fulfill({ body: "%PDF-1.7", contentType: "application/pdf" });
    return route.fulfill({ json: {} });
  });

  await page.goto("/kiem-tra?doc=18");
  await expect(page.getByRole("heading", { name: "Kiểm định chữ ký số." })).toBeVisible();
  await expect(page.getByText("WINCA")).toBeVisible();
  await expect(page.getByText(/15\/6\/2027/)).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/kiem-tra\?doc=18$/);
  await expect(page.getByText("hồ sơ #18")).toBeVisible();
});
