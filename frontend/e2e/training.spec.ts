import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    username: "admin", role: "admin", customer_name: null,
    agent_default_ip: "127.0.0.1", default_location: "Đắk Lắk",
    using_default_secrets: false, must_change_password: false,
  }}));
  await page.route("**/api/training/jobs", (route) => route.fulfill({ status: 202, json: {
    jobId: "e2e-job", status: "running", stage: "Đang tìm trong kho iNut",
  }}));
  await page.route("**/api/training/jobs/e2e-job", (route) => route.fulfill({ json: {
    status: "done", stage: "Hoàn tất câu trả lời có nguồn", result: { sessionId: "e2e-session", answer: {
      answer: "Kiểm tra trạng thái FRPC, log kết nối và meta_token trước.",
      sourceBasis: "mixed",
      generalGuidance: "Xác nhận mạng ra Internet và đồng hồ hệ thống.",
      documentationEvidence: [{ title: "9.2 Kết Nối P2P / FRPC Tunnel", url: "https://inut.vn/help#frpc", quote: "Kiểm tra user và meta_token." }],
      videoEvidence: [{ title: "Thực hành iNut PC", url: "https://youtube.com/watch?v=test&t=42s", timestamp: "00:42", quote: "Mở trang cấu hình tunnel." }],
    } },
  }}));
  await page.route("**/api/training/stats", (route) => route.fulfill({ json: {
    totals: { questions: 3, tokens: 420, successful: 3 }, users: [], recent: [], tokenNote: "Token ước tính",
  }}));
  await page.route("**/api/training/history", (route) => route.fulfill({ json: {
    items: [{ jobId: "old-job", question: "Câu hỏi cũ của tôi", status: "done", answer: { answer: "Trả lời cũ", sourceBasis: "documentation-only", documentationEvidence: [] }, createdAt: "2026-07-28T10:00:00Z", completedAt: "2026-07-28T10:00:03Z", durationMs: 3000 }],
  }}));
  await page.route("**/api/training/knowledge", (route) => route.fulfill({ json: { items: [] } }));
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
  await expect(page.getByText("Mọi câu hỏi và câu trả lời đều được lưu vào lịch sử")).toBeVisible();
  await expect(page.getByText("Câu hỏi cũ của tôi")).toBeVisible();
  await page.getByLabel("Câu hỏi cho iNut Training").fill("cài frpc lỗi giờ sao");
  await page.getByRole("button", { name: "Hỏi Hermes" }).click();

  await expect(page.getByText("Kiểm tra trạng thái FRPC")).toBeVisible();
  await expect(page.getByText("9.2 Kết Nối P2P / FRPC Tunnel").first()).toBeVisible();
  await expect(page.getByText("00:42")).toBeVisible();

  await page.getByRole("button", { name: "Tạo link gửi khách" }).click();
  await expect(page.getByText("https://example.test/t/public-answer")).toBeVisible();
});
