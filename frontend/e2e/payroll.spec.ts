import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("admin creates, reviews and locks an anonymized payroll period", async ({ page }, testInfo) => {
  let period: any = null;
  let workbookDraft: any = null;
  let syncPolls = 0;
  let hrPaid = 0;
  let hrHasEvidence = false;
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
        imported_at: new Date().toISOString(), findings: [{ level: "vang", code: "meal_cap", message: "Tiền ăn vượt mức miễn thuế.", cells: ["H15"] }] }] });
    }
    if (path === "/api/payroll/hr-summary") {
      return route.fulfill({ json: { year: 2026, totals: {
        net_payable: 49525770, paid: 28387885 + hrPaid, outstanding: 21137885 - hrPaid,
        pit_withheld: 142176, annual_pit: 0,
      }, employees: [{ employee_id: 2, code: "HR-DEMO", name: "Huỳnh Đức Nhâm", position: "NV",
        net_payable: 21137885, paid: hrPaid, outstanding: 21137885 - hrPaid, gross_income: 21715385,
        tax: { withheld: 0, annual_pit: 0, annual_taxable_income: 0, balance: 0,
          self_deduction: 186000000, dependent_deduction: 0, education_deduction: 0,
          basis: "Dữ liệu thu nhập do công ty quản lý" },
        months: [{ month: "2026-07", statement_id: 5, source_import_id: 9,
          gross_income: 21715385, employee_insurance: 577500, pit_withheld: 0,
          net_payable: 21137885, paid: hrPaid, outstanding: 21137885 - hrPaid,
          reconciliation_status: hrPaid ? (hrHasEvidence ? "paid" : "missing_evidence") : "unpaid",
          payments: hrPaid ? [{ id: 7, employee_id: 2, month: "2026-07", amount: hrPaid,
            status: "completed", paid_at: new Date().toISOString(), bank_name: "", transaction_ref: "",
            note: "Đã chuyển", evidence_name: hrHasEvidence ? "uy-nhiem-chi.pdf" : "",
            evidence_missing: !hrHasEvidence, cancel_reason: "" }] : [] }] },
        { employee_id: 3, code: "HR-KHANH", name: "Ngô Huỳnh Ngọc Khánh", position: "GĐ",
          net_payable: 28387885, paid: 28387885, outstanding: 0, gross_income: 29107561,
          tax: { withheld: 142176, annual_pit: 0, annual_taxable_income: 0, balance: -142176,
            self_deduction: 186000000, dependent_deduction: 43400000, education_deduction: 0,
            basis: "Dữ liệu thu nhập do công ty quản lý" },
          months: [{ month: "2026-07", statement_id: 6, source_import_id: 9,
            gross_income: 29107561, employee_insurance: 577500, pit_withheld: 142176,
            net_payable: 28387885, paid: 28387885, outstanding: 0,
            reconciliation_status: "missing_evidence", payments: [] }] }] } });
    }
    if (path === "/api/payroll/payments" && route.request().method() === "POST") {
      hrPaid = route.request().postDataJSON().amount;
      return route.fulfill({ json: { id: 7, employee_id: 2, month: "2026-07", amount: hrPaid,
        status: "completed", paid_at: new Date().toISOString(), bank_name: "", transaction_ref: "",
        note: "Đã chuyển", evidence_name: "", evidence_missing: true, cancel_reason: "" } });
    }
    if (path === "/api/payroll/payments/7/evidence") {
      hrHasEvidence = true;
      return route.fulfill({ json: { id: 7, employee_id: 2, month: "2026-07", amount: hrPaid,
        status: "completed", paid_at: new Date().toISOString(), bank_name: "", transaction_ref: "",
        note: "Đã chuyển", evidence_name: "uy-nhiem-chi.pdf", evidence_missing: false, cancel_reason: "" } });
    }
    if (path === "/api/payroll/imports/9") {
      return route.fulfill({ json: { id: 9, month: "2026-07", filename: "Bang-luong-07-2026.xlsx",
        imported_at: new Date().toISOString(), findings: [{ level: "vang", code: "meal_cap", message: "Tiền ăn vượt mức miễn thuế.", cells: ["H15"] }],
        snapshot: { sheet: "Tháng 7-2026", month: "2026-07", ncols: 40,
          grid: [...Array.from({ length: 14 }, () => Array(40).fill("")),
            ["1", "NV-DEMO", "Nhân viên mẫu", "12000000", "22", "22", "12000000", "1500000", "", "", "", "", "", "", "", "", "13500000", "12000000", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "", "", "12240000", "16080000", "", "", ""]] } } });
    }
    if (path === "/api/payroll/imports/9/draft" && route.request().method() === "GET") {
      return route.fulfill({ json: { draft: workbookDraft } });
    }
    if (path === "/api/payroll/imports/9/net-target") {
      const taxableBonus = route.request().postDataJSON().allow_taxable_bonus === true;
      return route.fulfill({ json: {
        feasible: true, current_net: 12240000, target_net: 13000000, proposed_net: 13000000, shortfall: 0,
        current_pit: 0, proposed_pit: taxableBonus ? 50000 : 0, current_employee_insurance: 1260000, proposed_employee_insurance: 1260000,
        proposed: { meal_allowance: 760000, overtime_weekday_hours: 0, overtime_weekend_hours: 0,
          attendance_bonus: taxableBonus ? 3050000 : null, performance_bonus: taxableBonus ? 3050000 : 0 },
        cashflows: [
          { key: "meal", label: "Tiền ăn", current: 0, proposed: 760000, delta: 760000 },
          { key: "pit", label: "Thuế TNCN", current: 0, proposed: 0, delta: 0 },
          { key: "insurance", label: "BHXH người lao động", current: 1260000, proposed: 1260000, delta: 0 },
          { key: "net", label: "Thực lĩnh", current: 12240000, proposed: 13000000, delta: 760000 },
          { key: "employer_cost", label: "Tổng chi phí công ty", current: 16080000, proposed: 16840000, delta: 760000 },
        ],
        dependencies: ["Tiền ăn phải có quy chế công ty.", "Giờ làm thêm phải có bảng chấm công và phê duyệt."], warnings: [],
      }});
    }
    if (path === "/api/payroll/imports/9/draft" && route.request().method() === "POST") {
      workbookDraft = { id: 12, import_id: 9, status: "draft", changes: route.request().postDataJSON().changes,
        findings: [], drive_filename: "", updated_at: new Date().toISOString() };
      return route.fulfill({ json: workbookDraft });
    }
    if (path === "/api/payroll/drafts/12/review") {
      workbookDraft = { ...workbookDraft, status: "reviewed", findings: [] };
      return route.fulfill({ json: workbookDraft });
    }
    if (path === "/api/payroll/drafts/12/upload-drive") {
      workbookDraft = { ...workbookDraft, status: "uploaded", drive_filename: "Bang-luong-07-2026 - da review.xlsx" };
      return route.fulfill({ json: workbookDraft });
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
  await expect(page.getByRole("heading", { name: "Bức tranh HR năm 2026" })).toBeVisible();
  await expect(page.getByLabel("Tổng quan thanh toán và thuế năm")).toContainText("49.525.770");
  await expect(page.getByRole("heading", { name: "Biểu đồ lương và thuế" })).toBeVisible();
  await expect(page.getByLabel("Biểu đồ của Huỳnh Đức Nhâm")).toContainText("21.137.885");
  await expect(page.getByLabel("Biểu đồ của Ngô Huỳnh Ngọc Khánh")).toContainText("28.387.885");
  await expect(page.getByLabel("Biểu đồ của Ngô Huỳnh Ngọc Khánh")).toContainText("142.176");
  await page.getByLabel("Hiển thị Ngô Huỳnh Ngọc Khánh").uncheck();
  await expect(page.getByLabel("Biểu đồ của Ngô Huỳnh Ngọc Khánh")).toHaveCount(0);
  await page.getByRole("button", { name: "Bỏ chọn" }).click();
  await expect(page.getByText("Chọn ít nhất một nhân viên để xem biểu đồ.")).toBeVisible();
  await page.getByRole("button", { name: "Chọn tất cả" }).click();
  await expect(page.getByLabel("Biểu đồ của Ngô Huỳnh Ngọc Khánh")).toBeVisible();
  await page.getByRole("button", { name: /Huỳnh Đức Nhâm/ }).click();
  await page.getByLabel("Số tiền đã chuyển").fill("21137885");
  await page.getByRole("button", { name: "Ghi nhận đã chuyển" }).click();
  await expect(page.getByText("Thiếu chứng từ", { exact: true })).toBeVisible();
  await page.getByLabel("Chứng từ chuyển khoản").setInputFiles({
    name: "uy-nhiem-chi.pdf", mimeType: "application/pdf", buffer: Buffer.from("demo"),
  });
  await expect(page.getByText("Đã đối chiếu", { exact: true })).toBeVisible();
  await page.getByLabel("Tháng lương").fill("2026-07");
  await page.getByRole("button", { name: "Tạo tháng" }).click();
  await expect(page.getByText("NV-DEMO")).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("reviewed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Khóa sổ" }).click();
  await expect(page.getByText("locked", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Bang-luong-07-2026\.xlsx/ }).click();
  await expect(page.getByRole("heading", { name: "Bang-luong-07-2026.xlsx" })).toBeVisible();
  await page.getByRole("button", { name: /NV-DEMO/ }).click();
  const legalGuide = page.getByLabel("Quy định ghi nhận lương và làm thêm từ 01/07/2026");
  await expect(legalGuide).toContainText("Không quá 40 giờ làm thêm trong tháng");
  await expect(legalGuide).toContainText("Ngày thường 150%");
  await expect(legalGuide).toContainText("Ngày nghỉ hằng tuần 200%");
  await expect(legalGuide).toContainText("Ngày lễ, Tết 300%");
  await expect(legalGuide).toContainText("Thưởng hiệu quả kinh doanh chịu thuế TNCN");
  await expect(legalGuide).toContainText("Không sửa giảm giờ đã làm thực tế");
  await expect(legalGuide).toContainText("Công ty quyết toán thay");
  await expect(legalGuide).toContainText("Cá nhân tự quyết toán");
  await expect(legalGuide).toContainText("24 triệu đồng/năm");
  await expect(legalGuide).toContainText("không tự trừ vào thuế tháng");
  await page.getByLabel("Thực lĩnh muốn nhận").fill("13000000");
  await expect(page.getByLabel("Giờ tăng ca thường có thật")).toHaveCount(0);
  await page.getByRole("button", { name: "Tự tính phương án" }).click();
  await expect(page.getByText("Đủ dư địa hợp pháp")).toBeVisible();
  await expect(page.getByLabel("So sánh dòng tiền với file đã submit")).toContainText("+760.000");
  await expect(page.locator(".cashflow-row.better", { hasText: "Thực lĩnh" })).toBeVisible();
  await expect(page.locator(".cashflow-row.worse", { hasText: "Tổng chi phí công ty" })).toBeVisible();
  await page.getByText("Khớp thực lĩnh bằng thưởng hiệu quả chịu thuế").click();
  await page.getByRole("button", { name: "Tự tính phương án" }).click();
  await expect(page.getByText("Thuế TNCN tăng 50.000 đồng; BHXH giữ nguyên.")).toBeVisible();
  await page.getByRole("button", { name: "Áp dụng và lưu bản nháp" }).click();
  await expect(page.getByLabel("Tiền ăn")).toHaveValue("760000");
  await expect(page.getByText("Đã áp dụng và lưu bản nháp.")).toBeVisible();
  await page.getByLabel("Tiền ăn").fill("1200000");
  await page.getByLabel("Chuyên cần hoặc thưởng").fill("2000000");
  await page.getByLabel("Giờ làm thêm trong tuần").fill("12");
  await page.getByLabel("Giờ làm thêm cuối tuần").fill("8");
  await page.getByLabel("Lý do điều chỉnh").fill("Tháng có nhiều hợp đồng");
  await page.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
  await expect(page.getByText("Đã lưu bản nháp.")).toBeVisible();
  await page.getByRole("button", { name: "Chạy lại review" }).click();
  await expect(page.getByText("Review xong: 0 cảnh báo.")).toBeVisible();
  await page.getByRole("button", { name: "Cập nhật file gốc trên Drive" }).click();
  await expect(page.getByText(/Đã gửi lên Google Drive/)).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await expect(page.getByLabel("Tóm tắt bảng lương 2026-07")).toContainText("Nhân viên mẫu");
    await expect(page.getByLabel("Tóm tắt bảng lương 2026-07")).toContainText("12.240.000");
    await expect(page.getByLabel("Nội dung bảng lương 2026-07")).toBeHidden();
    await page.getByRole("button", { name: /Xem ô H15/ }).click();
    await expect(page.getByLabel("Nội dung bảng lương 2026-07")).toBeVisible();
    await expect(page.locator("#payroll-cell-9-H15")).toHaveClass(/cell-focus/);
  } else {
    await expect(page.getByLabel("Nội dung bảng lương 2026-07")).toContainText("NV-DEMO");
  }

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
