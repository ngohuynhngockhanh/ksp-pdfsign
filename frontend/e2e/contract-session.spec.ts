import { expect, test } from "@playwright/test";

test("final contract closes the editing session and offers a fresh one", async ({ page }) => {
  let generatedDraftId: number | null = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: false, must_change_password: false,
    }});
    if (path === "/api/customers") return route.fulfill({ json: [{ id: 5, name: "CÔNG TY DEMO", tax_code: "0312345688", contact: "", address: "Đắk Lắk", email: "demo@example.test", logo_url: "", note: "", created_at: "", document_count: 0, account_usernames: [], aliases: [] }] });
    if (path === "/api/contract/defaults") return route.fulfill({ json: { ben_a: { company: "INUT", mst: "4401053694", rep: "Đại diện" }, bank: { account_name: "INUT", account_number: "79713", bank_name: "MB" }, dieu_khoan: "Điều 1. Phạm vi", baotoan: { name: "CÔNG TY DEMO", mst: "0312345688", address: "Đắk Lắk", email: "demo@example.test" } } });
    if (path === "/api/contract/drafts") return route.fulfill({ json: [{ id: 17, customer_id: 5, customer_name: "CÔNG TY DEMO", title: "Hợp đồng đợt 1", version: 1, status: "draft", document_id: null, finalized_at: null, payload: { so: "01/2026/HĐ", ngay: { day: 31, month: 7, year: 2026 }, ben_b: { name: "CÔNG TY DEMO", mst: "0312345688", dai_dien: "Nguyễn Văn A" }, dieu_khoan: "Điều 1. Phạm vi" }, created_at: "2026-07-31T08:00:00Z", updated_at: "2026-07-31T08:00:00Z" }] });
    if (path === "/api/documents") return route.fulfill({ json: { items: [], total: 0, page: 1, per_page: 200 } });
    if (path === "/api/contract/generate") {
      generatedDraftId = request.postDataJSON().draft_id;
      return route.fulfill({ json: { doc_id: "doc-1", document_id: 31, filename: "hop-dong.pdf", customer_id: 5, is_draft: false, session_finalized: true, share_url: "https://example.test/share", login_url: "https://example.test/login", username: "demo", temporary_password: "", share_expires_at: "", login_expires_at: "" } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/soan-hop-dong");
  await page.getByRole("button", { name: /Hợp đồng đợt 1/ }).click();
  await page.getByRole("button", { name: "Lưu hợp đồng & tạo link" }).click();

  expect(generatedDraftId).toBe(17);
  await expect(page.getByText("Phiên v1 đã chốt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo phiên làm việc mới" })).toBeVisible();

  await page.getByRole("button", { name: "Tạo phiên làm việc mới" }).click();
  await expect(page.getByLabel("Tên bản đang soạn")).toHaveValue("");
  await expect(page.getByText("Phiên v1 đã chốt")).toHaveCount(0);
});
