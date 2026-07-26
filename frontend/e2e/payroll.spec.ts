import { expect, test } from "@playwright/test";

test("admin creates, reviews and locks an anonymized payroll period", async ({ page }) => {
  let period: any = null;
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
});
