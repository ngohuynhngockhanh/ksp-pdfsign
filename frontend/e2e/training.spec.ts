import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    username: "admin", role: "admin", customer_name: null,
    agent_default_ip: "127.0.0.1", default_location: "Đắk Lắk",
    using_default_secrets: false, must_change_password: false,
  }}));
  await page.route("**/api/training/ask", (route) => route.fulfill({ json: {
    sessionId: "e2e-session",
    answer: {
      answer: "Kiểm tra trạng thái FRPC, log kết nối và meta_token trước.",
      sourceBasis: "mixed",
      generalGuidance: "Xác nhận mạng ra Internet và đồng hồ hệ thống.",
      documentationEvidence: [{ title: "9.2 Kết Nối P2P / FRPC Tunnel", url: "https://inut.vn/help#frpc", quote: "Kiểm tra user và meta_token." }],
      videoEvidence: [{ title: "Thực hành iNut PC", url: "https://youtube.com/watch?v=test&t=42s", timestamp: "00:42", quote: "Mở trang cấu hình tunnel." }],
    },
  }}));
  await page.route("**/api/training/search?*", (route) => route.fulfill({ json: { results: [{
    sourceType: "help", sourceId: "help:frpc", sourceTitle: "9.2 Kết Nối P2P / FRPC Tunnel",
    text: "Cấu hình FRPC multiuser bằng user và meta_token.", citationUrl: "https://inut.vn/help#frpc", score: 12,
  }] }}));
  await page.route("**/api/training/share", (route) => route.fulfill({ json: {
    url: "https://example.test/t/public-answer", expires_at: "2026-08-26T00:00:00",
  }}));
});

test("admin asks Hermes and creates a customer link", async ({ page }) => {
  await page.goto("/training");
  await page.getByLabel("Câu hỏi cho iNut Training").fill("cài frpc lỗi giờ sao");
  await page.getByRole("button", { name: "Hỏi Hermes" }).click();

  await expect(page.getByText("Kiểm tra trạng thái FRPC")).toBeVisible();
  await expect(page.getByText("9.2 Kết Nối P2P / FRPC Tunnel").first()).toBeVisible();
  await expect(page.getByText("00:42")).toBeVisible();

  await page.getByRole("button", { name: "Tạo link gửi khách" }).click();
  await expect(page.getByText("https://example.test/t/public-answer")).toBeVisible();
});
