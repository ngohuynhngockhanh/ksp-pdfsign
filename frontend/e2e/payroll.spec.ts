import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("admin creates, reviews and locks an anonymized payroll period", async ({ page }) => {
  let period: any = null;
  let syncPolls = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: false, must_change_password: false,
    }});
    if (path === "/api/payroll/periods" && route.request().method() === "GET") {
      return route.fulfill({ json: period ? [period] : [] });
    }
    if (path === "/api/payroll/imports" && route.request().method() === "GET") {
      return route.fulfill({ json: [{ id: 9, month: "2026-07", filename: "Bang-luong-07-2026.xlsx",
        imported_at: new Date().toISOString(), findings: [{ level: "do", code: "missing_kpcd", message: "Cột KPCĐ 2% đang trống." }] }] });
    }
    if (path === "/api/payroll/imports/9") {
      return route.fulfill({ json: { id: 9, month: "2026-07", filename: "Bang-luong-07-2026.xlsx",
        imported_at: new Date().toISOString(), findings: [{ level: "do", code: "missing_kpcd", message: "Cột KPCĐ 2% đang trống." }],
        snapshot: { sheet: "Tháng 7-2026", month: "2026-07", ncols: 3,
          grid: [["BẢNG LƯƠNG THÁNG 7/2026", "", ""], ["STT", "Mã NV", "Họ tên"], ["1", "NV-DEMO", "Nhân viên mẫu"]] } } });
    }
    if (path === "/api/payroll/periods" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      period = { id: 1, month: body.month, version: 1, status: "draft", findings: [], lines: [{
        id: 7, employee_id: 3, employee: { code: "NV-DEMO", name: "Nhân viên mẫu", base_salary: 12000000 },
        standard_days: 22, actual_days: 0, overtime_pay: 0, bonus: 0, other_taxable: 0,
        unpaid_deduction: 0, computed: { gross_income: 0, employee_insurance: 1260000,
          pit: 0, net_income: 0, total_employer_cost: 2820000 }, overrides: {}, override_reason: "",
      }]};
      return route.fulfill({ json: period });
    }
    if (path === "/api/payroll/sync-drive" && route.request().method() === "POST") {
      return route.fulfill({ json: { job_id: 4, status: "running" } });
    }
    if (path === "/api/payroll/sync-drive/status") {
      syncPolls += 1;
      const done = syncPolls >= 3;
      return route.fulfill({ json: { job: { id: 4, status: done ? "success" : "running", error: "",
        started_at: new Date().toISOString(), finished_at: done ? new Date().toISOString() : "",
        stats: { progress: done ? 100 : 55, message: done ? "Hoàn tất 7 file" : "Đang kiểm tra các file Excel",
          files: done ? Array(7).fill("demo.xlsx") : [], imported: done ? 7 : 0 } } } });
    }
    if (path.endsWith("/review")) { period.status = "reviewed"; return route.fulfill({ json: period }); }
    if (path.endsWith("/lock")) { period.status = "locked"; return route.fulfill({ json: period }); }
    return route.fulfill({ json: {} });
  });

  await page.goto("/bang-luong");
  await expect(page.getByRole("heading", { name: "Bảng lương & kiểm soát tuân thủ" })).toBeVisible();
  await page.getByLabel("Tháng lương").fill("2026-07");
  await page.getByRole("button", { name: "Tạo tháng" }).click();
  await expect(page.getByText("NV-DEMO")).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("reviewed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Khóa sổ" }).click();
  await expect(page.getByText("locked", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Bang-luong-07-2026\.xlsx/ }).click();
  await expect(page.getByRole("heading", { name: "Bang-luong-07-2026.xlsx" })).toBeVisible();
  await expect(page.getByLabel("Nội dung bảng lương 2026-07")).toContainText("NV-DEMO");

  await page.getByRole("button", { name: "Sync Drive" }).click();
  await expect(page.getByRole("progressbar", { name: "Tiến độ đồng bộ Drive" })).toHaveAttribute("aria-valuenow", "100", { timeout: 5000 });
  await expect(page.getByText("7 file · 7 file mới")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const accessibility = await new AxeBuilder({ page })
    .include(".payroll-page")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
