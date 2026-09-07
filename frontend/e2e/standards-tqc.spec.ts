import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    username: "admin", role: "admin", customer_name: null,
    agent_default_ip: "127.0.0.1", default_location: "Đắk Lắk",
    using_default_secrets: false, must_change_password: false,
  }}));
  await page.route("**/api/standards/statistics", (route) => route.fulfill({ json: { total_standards: 1, by_ministry: {}, by_category: {}, updated_at: "2026-08-24" } }));
  await page.route("**/api/standards/search*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/standards/hs-mappings", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/standards/testing-labs", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/standards/playbooks", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/standards/game/state", (route) => route.fulfill({ json: {
    current_level: 1, current_level_title: "Khởi động", current_exp: 0, max_exp: 3000,
    progress_percent: 0, completed_quests_count: 0, total_quests: 0, ai_companion_cheer: "", quests: [],
  }}));
  await page.route("**/api/standards/tqc/status", (route) => route.fulfill({ json: {
    enabled: true, base_url: "https://api-cnhq.tqc.gov.vn", api_key_configured: false,
    rate_limit_per_minute: 450, cache_ttl_seconds: 86400, search_mode: "official_exact_plus_local_index",
  }}));
  await page.route("**/api/standards/tqc/search*", (route) => route.fulfill({ json: {
    items: [{
      certificate_no: "C0955191224AE15A3", issue_date: "2024-12-18", expiry_date: "2027-12-18",
      applicant_name: "CÔNG TY INUT", product_name: "Thiết bị IoT", model: "T27G16", manufacturer: "TOMKO",
      factory_name: "", factory_address: "", technical_regulations: ["QCVN 54:2020/BTTTT"],
      certification_method: "1", serial_form_no: "", source_status: "còn hiệu lực", derived_status: "active",
      provenance: { verification_status: "verified_cached", source_url: "local", checked_at: "2026-08-24T00:00:00Z" },
    }], total: 1, page: 1, page_size: 50, search_scope: "local_index", index_last_updated_at: "2026-08-24T00:00:00Z",
  }}));
  await page.route("**/api/standards/tqc/certificates/*", (route) => route.fulfill({ json: { certificate: {
    certificate_no: "C0955191224AE15A3", issue_date: "2024-12-18", expiry_date: "2027-12-18",
    applicant_name: "CÔNG TY INUT", product_name: "Thiết bị IoT", model: "CPH2699", manufacturer: "OPPO",
    factory_name: "", factory_address: "", technical_regulations: ["QCVN 117:2023/BTTTT"],
    certification_method: "1", serial_form_no: "", source_status: "còn hiệu lực", derived_status: "active",
    provenance: { verification_status: "verified_live", source_url: "https://api-cnhq.tqc.gov.vn/api/search/C0955191224AE15A3", checked_at: "2026-08-24T00:00:00Z" },
  } } }));
  await page.route("**/api/standards/tqc/import", (route) => route.fulfill({ json: {
    requested: 1, processed: 1, verified: 1, cached: 0, not_found: 0, errors: [], items: [],
  }}));
  await page.route("**/api/standards/tqc/import/csv*", (route) => route.fulfill({ status: 202, json: {
    job_id: 42, status: "running", requested: 1,
  }}));
  await page.route("**/api/standards/tqc/import/jobs/42", (route) => route.fulfill({ json: {
    job_id: 42, status: "success", phase: "done", progress: 100, requested: 1,
    result: { requested: 1, processed: 1, verified: 1, cached: 0, not_found: 0, errors: [], items: [] },
    error: "", started_at: "2026-08-24T00:00:00Z", finished_at: "2026-08-24T00:00:01Z",
  }}));
  await page.route("**/api/standards/tqc/import/jobs/latest", (route) => route.fulfill({ json: { job: null } }));
});

test("admin searches the TQC model index", async ({ page }) => {
  await page.goto("/standards/tqc");
  await expect(page.getByRole("heading", { name: "Tra cứu chứng nhận theo model" })).toBeVisible();
  await page.getByLabel("Model").fill("T27G16");
  await page.getByRole("button", { name: "Tìm trong index" }).click();
  await expect(page.getByText("T27G16").last()).toBeVisible();
  await expect(page.getByText("TOMKO").last()).toBeVisible();
  await expect(page.getByText("Cache đã xác minh")).toBeVisible();
});

test("admin verifies an exact certificate live", async ({ page }) => {
  await page.goto("/standards/tqc");
  await page.getByLabel("Số GCN").fill("C0955191224AE15A3");
  await page.getByRole("button", { name: "Kiểm tra số GCN live" }).click();
  await expect(page.getByText("CPH2699").last()).toBeVisible();
  await expect(page.getByText("Đã xác minh live")).toBeVisible();
});

test("admin previews pasted entries before import", async ({ page }) => {
  await page.goto("/standards/tqc");
  await page.getByLabel("Danh sách GCN hoặc QR TQC").fill("C0955191224AE15A3");
  await page.getByRole("button", { name: "Xem trước dữ liệu dán" }).click();
  await expect(page.getByText(/Xem trước: 1 entry/)).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận import 1 entry" }).click();
  await expect(page.getByText(/Đã xử lý 1: xác minh 1/)).toBeVisible();
});

test("empty TQC search asks for any search condition", async ({ page }) => {
  await page.goto("/standards/tqc");
  await page.getByRole("button", { name: "Tìm trong index" }).click();
  await expect(page.getByText("Nhập ít nhất một điều kiện tìm kiếm.")).toBeVisible();
});

test("admin follows a background CSV import until completion", async ({ page }) => {
  let pollCount = 0;
  await page.route("**/api/standards/tqc/import/jobs/42", (route) => {
    pollCount += 1;
    if (pollCount === 1) return route.fulfill({ status: 503, json: { detail: "temporary restart" } });
    return route.fulfill({ json: {
      job_id: 42, status: "success", phase: "done", progress: 100, requested: 1,
      result: { requested: 1, processed: 1, verified: 1, cached: 0, not_found: 0, errors: [], items: [] },
      error: "", started_at: "2026-08-24T00:00:00Z", finished_at: "2026-08-24T00:00:01Z",
    } });
  });
  await page.goto("/standards/tqc");
  await page.locator('input[type="file"]').setInputFiles({
    name: "tqc.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("certificate_no\nC0955191224AE15A3\n"),
  });
  await page.getByRole("button", { name: "Xác nhận import CSV" }).click();
  await expect(page.getByText(/CSV: xác minh 1, cache 0/)).toBeVisible();
  expect(pollCount).toBeGreaterThanOrEqual(2);
});

test("page resumes the latest running CSV import", async ({ page }) => {
  await page.route("**/api/standards/tqc/import/jobs/latest", (route) => route.fulfill({ json: { job: {
    job_id: 42, status: "running", phase: "running", progress: 55, requested: 1,
    result: null, error: "", started_at: "2026-08-24T00:00:00Z", finished_at: null,
  } } }));
  await page.goto("/standards/tqc");
  await expect(page.getByText(/CSV: xác minh 1, cache 0/)).toBeVisible();
});

test("admin retries the latest failed CSV import", async ({ page }) => {
  await page.route("**/api/standards/tqc/import/jobs/latest", (route) => route.fulfill({ json: { job: {
    job_id: 42, status: "failed", phase: "running", progress: 55, requested: 1,
    result: null, error: "TQC tạm thời không phản hồi", started_at: "2026-08-24T00:00:00Z", finished_at: "2026-08-24T00:01:00Z",
  } } }));
  await page.route("**/api/standards/tqc/import/jobs/42/retry", (route) => route.fulfill({ status: 202, json: {
    job_id: 42, status: "running", phase: "running", progress: 55, requested: 1,
    result: null, error: "", started_at: "2026-08-24T00:00:00Z", finished_at: null,
  } }));
  await page.goto("/standards/tqc");
  await expect(page.getByText(/TQC tạm thời không phản hồi/)).toBeVisible();
  await page.getByRole("button", { name: "Thử lại import CSV" }).click();
  await expect(page.getByText(/CSV: xác minh 1, cache 0/)).toBeVisible();
});
