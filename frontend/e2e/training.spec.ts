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
    runtime: { limit: 100, windowSeconds: 60, windowCount: 1, active: 0, total: 3, completed: 3, failed: 0, rejected: 0, lastError: "" },
    facebook: { total: 3, inbound: 2, outbound: 1, replied: 0, rejected: 0, failed: 1, statuses: {}, latency: { count: 0, averageMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 }, stages: { queue: { count: 0, averageMs: 0, p95Ms: 0, maxMs: 0 }, context: { count: 0, averageMs: 0, p95Ms: 0, maxMs: 0 }, hermes: { count: 0, averageMs: 0, p95Ms: 0, maxMs: 0 }, send: { count: 0, averageMs: 0, p95Ms: 0, maxMs: 0 }, profile: { count: 0, averageMs: 0, p95Ms: 0, maxMs: 0 } }, recent: [] },
  }}));
  await page.route("**/api/users", (route) => route.fulfill({ json: [{ id: 1, username: "admin", role: "admin", customer_name: null, training_access: true }] }));
  await page.route("**/api/training/public-leads", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/facebook/conversations*", (route) => route.fulfill({ json: { items: [{
    conversationId: "page-1:person-1", pageId: "page-1", psid: "person-1", name: "Khách thử nghiệm", messageCount: 2,
    failedCount: 1, lastText: "Alo", lastDirection: "inbound", lastStatus: "failed", lastAt: "2026-08-05T10:40:55Z", lastLatencyMs: 0,
  }] } }));
  await page.route("**/api/facebook/conversations/page-1/person-1", (route) => route.fulfill({ json: {
    pageId: "page-1", psid: "person-1", name: "Khách thử nghiệm", items: [{ id: 81, direction: "inbound", text: "Alo", status: "failed", error: "Hermes Training khong tra loi duoc", createdAt: "2026-08-05T10:40:55Z", queueLatencyMs: 0, latencyMs: 0, hermesLatencyMs: 0, contextLatencyMs: 0, sendLatencyMs: 0 }],
  } }));
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
  await page.getByRole("button", { name: "Kỹ thuật / nguồn" }).click();
  await expect(page.getByRole("heading", { name: "Inbox fanpage iNut" })).toHaveCount(0);
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

test("admin can use the marketing assistant mode", async ({ page }) => {
  let sentMode = "";
  await page.route("**/api/training/jobs", async (route) => {
    sentMode = String(route.request().postDataJSON()?.mode || "");
    await route.fulfill({ status: 202, json: {
      jobId: "e2e-job", status: "running", stage: "Đang tìm trong kho iNut",
    } });
  });

  await page.goto("/training");
  await page.getByRole("button", { name: "Tư vấn bán hàng / Marketing" }).click();
  await expect(page.getByText("Marketing assistant an toàn")).toBeVisible();
  await page.getByLabel("Câu hỏi cho iNut Training").fill("Khách cần gateway RS485 cho nhà máy");
  await page.getByRole("button", { name: "Hỏi Hermes" }).click();

  await expect(page.getByText("TƯ VẤN BÁN HÀNG CÓ NGUỒN")).toBeVisible();
  expect(sentMode).toBe("sales");
  await expect(page.getByText("Bước tiếp theo cho khách", { exact: true })).toBeVisible();
});

test("admin can filter Messenger history and see an actionable Hermes failure", async ({ page }) => {
  await page.goto("/messenger");
  await expect(page).toHaveURL(/\/messenger$/);
  await expect(page.getByRole("heading", { name: "Messenger fanpage" })).toBeVisible();
  await expect(page.getByText("1 lỗi lịch sử")).toBeVisible();
  await page.getByLabel("Tìm hội thoại Messenger").fill("Khách thử nghiệm");
  await page.getByRole("button", { name: /Khách thử nghiệm/ }).click();
  await expect(page.getByText("Hermes chưa tạo được câu trả lời")).toBeVisible();
  await expect(page.getByText("Lỗi · lỗi đã dừng")).toBeVisible();
  await page.getByLabel("Lọc trạng thái Messenger").selectOption("replied");
  await expect(page.getByText("Không có hội thoại khớp bộ lọc hiện tại.")).toBeVisible();
});
