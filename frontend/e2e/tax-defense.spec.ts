import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

function mockTaxDefense(page: Page) {
  return page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") {
      return route.fulfill({
        json: {
          username: "admin",
          role: "admin",
          customer_name: null,
          agent_default_ip: "",
          default_location: "Đắk Lắk",
          using_default_secrets: false,
          must_change_password: false,
          training_access: false,
          portal_scope: "full",
        },
      });
    }

    if (path === "/api/tax-defense/overview") {
      return route.fulfill({
        json: {
          years: ["2022", "2023", "2024", "2025", "2026"],
          summary_matrix: [
            {
              year: "2022",
              sale_invoices_count: 19,
              sale_invoices_gross: 19,
              revenue_pretax: 1260187088,
              revenue_vat: 13553549,
              revenue_payment: 1273740637,
              purchase_invoices_count: 0,
              cost_pretax: 0,
              cost_vat_input: 0,
              cost_total: 0,
              cost_to_revenue_pct: 0.0,
              vat_input_to_output_pct: 0.0,
              net_vat_payable: 13553549,
              vat_payable_to_rev_pct: 1.08,
              has_purchase_records: false,
              benchmark_norm_cost_pct: 62.0,
            },
            {
              year: "2023",
              sale_invoices_count: 49,
              sale_invoices_gross: 50,
              revenue_pretax: 1336774646,
              revenue_vat: 78099465,
              revenue_payment: 1414874111,
              purchase_invoices_count: 0,
              cost_pretax: 0,
              cost_vat_input: 0,
              cost_total: 0,
              cost_to_revenue_pct: 0.0,
              vat_input_to_output_pct: 0.0,
              net_vat_payable: 78099465,
              vat_payable_to_rev_pct: 5.84,
              has_purchase_records: false,
              benchmark_norm_cost_pct: 62.0,
            },
            {
              year: "2024",
              sale_invoices_count: 35,
              sale_invoices_gross: 36,
              revenue_pretax: 422983647,
              revenue_vat: 40900465,
              revenue_payment: 463884112,
              purchase_invoices_count: 0,
              cost_pretax: 0,
              cost_vat_input: 0,
              cost_total: 0,
              cost_to_revenue_pct: 0.0,
              vat_input_to_output_pct: 0.0,
              net_vat_payable: 40900465,
              vat_payable_to_rev_pct: 9.67,
              has_purchase_records: false,
              benchmark_norm_cost_pct: 62.0,
            },
            {
              year: "2025",
              sale_invoices_count: 22,
              sale_invoices_gross: 22,
              revenue_pretax: 556839575,
              revenue_vat: 33561766,
              revenue_payment: 590401341,
              purchase_invoices_count: 47,
              cost_pretax: 68519100,
              cost_vat_input: 5479925,
              cost_total: 73999025,
              cost_to_revenue_pct: 12.31,
              vat_input_to_output_pct: 16.33,
              net_vat_payable: 28081841,
              vat_payable_to_rev_pct: 5.04,
              has_purchase_records: true,
              benchmark_norm_cost_pct: null,
            },
          ],
          revenue_details: {
            "2022": {
              year: "2022",
              invoice_count_gross: 19,
              invoice_count_net: 19,
              total_pretax: 1260187088,
              total_vat: 13553549,
              total_payment: 1273740637,
              gross_payment: 1273740637,
              adjusted_cancelled_count: 0,
              quarters: { "2022-Q4": { pretax: 1191697088, vat: 7514549, payment: 1199211637, count: 11 } },
              tiers: {
                tier_1_under_10m: { count: 11, amount: 46135640 },
                tier_2_10m_to_50m: { count: 6, amount: 111604997 },
                tier_3_50m_to_100m: { count: 0, amount: 0 },
                tier_4_over_100m: { count: 2, amount: 1116000000 },
              },
              tax_rates: {
                "0%": { pretax: 1116000000, vat: 0, count: 2 },
                "10%": { pretax: 128929088, vat: 12892909, count: 14 },
                "8%": { pretax: 3858000, vat: 308640, count: 1 },
                kct: { pretax: 0, vat: 0, count: 0 },
                "5%": { pretax: 0, vat: 0, count: 0 },
              },
              customers: {},
            },
          },
          cost_details: {
            "2025": {
              year: "2025",
              purchase_count: 47,
              pretax_cost: 68519100,
              vat_input: 5479925,
              total_payment: 73999025,
              by_category: {
                hang_hoa: { pretax: 25213357, vat: 2015467, count: 30 },
                dich_vu: { pretax: 43305743, vat: 3464458, count: 17 },
                nhap_khau: { pretax: 0, vat: 0, count: 0 },
              },
              suppliers: {},
              high_value_invoices: [],
            },
          },
          generated_at: new Date().toISOString(),
        },
      });
    }

    if (path === "/api/tax-defense/justification-dossier") {
      return route.fulfill({
        json: {
          title: "Bản thuyết minh giải trình doanh thu & cơ cấu chi phí thuế 2022-2025",
          company_name: "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
          tax_code: "4401053694",
          director: "Ngô Huỳnh Ngọc Khánh",
          years: ["2022", "2023", "2024", "2025"],
          markdown_content: "# BẢN THUYẾT MINH GIẢI TRÌNH DOANH THU & CƠ CẤU CHI PHÍ THUẾ\n\nCăn cứ Luật Quản lý thuế 38/2019/QH14 và Thông tư 219/2013/TT-BTC...\n\nHOÀN TOÀN KHÔNG PHỤ THUỘC TỒN KHO VẬT LÝ.",
          generated_at: new Date().toISOString(),
        },
      });
    }
    if (path === "/api/tax-defense/partner-status") {
      return route.fulfill({
        json: {
          total_checked: 15,
          active_count: 14,
          abandoned_count: 1,
          suspended_count: 0,
          closed_count: 0,
          high_risk_amount: 159060000,
          referers: {
            gdt_public_portal: {
              name: "Cổng Công Khai Thông Tin NNT - Tổng Cục Thuế",
              url: "https://congkhaithongtin.gdt.gov.vn",
              desc: "Chuyên trang công khai NNT Trạng thái 06",
              authority: "Tổng cục Thuế",
            },
          },
          partners: [
            {
              mst: "0316764844",
              name: "CÔNG TY TNHH TM DV KHÁNH LỢI",
              db_name: "CÔNG TY TNHH TM DV KHÁNH LỢI",
              role: "Khách hàng (Bán ra)",
              years: ["2024"],
              invoice_count: 9,
              total_amount: 159060000,
              total_buyer_amount: 159060000,
              total_supplier_amount: 0,
              address: "72/2A Nguyễn Thị Đành, Xã Xuân Thới Sơn, TP Hồ Chí Minh",
              status_code: "06",
              status_desc: "NNT không hoạt động tại địa chỉ đã đăng ký",
              risk_level: "high",
              is_abandoned: true,
              is_active: false,
              is_suspended: false,
              is_closed: false,
              defense_note: "Giao dịch bán hàng thực tế năm 2024, có hóa đơn cấp mã CQT hợp lệ.",
            },
          ],
          generated_at: new Date().toISOString(),
        },
      });
    }

    if (path === "/api/tax-defense/investigation-blacklist") {
      return route.fulfill({
        json: {
          title: "Chuyên đề rà soát doanh nghiệp điều tra mua bán hóa đơn",
          legal_basis: ["Công văn số 1798/TCT-TTKT"],
          official_referers: {},
          input_risks: {
            total_invoices: 13,
            total_pretax: 178552201,
            total_vat: 17000534,
            total_payment: 195550735,
            suspect_suppliers_count: 4,
            invoices: [
              {
                id: 1,
                so_hd: 2338,
                ky_hieu: "C23TKP",
                ngay: "2023-12-17",
                mst_ban: "0317866687",
                ten_ban: "CÔNG TY TNHH TMDV PHÁT TRIỂN KHẢI PHONG",
                tong_truoc_thue: 13360050,
                tong_thue: 1336005,
                tong_tien: 14696055,
                loai: "dich_vu",
                requires_bank_transfer: false,
                investigation_reference: "Công văn 1798/TCT-TTKT",
                current_status: "Trạng thái 06",
                action_advice: "Kiểm tra hồ sơ thực nhận.",
              },
            ],
            guidance: "Cần kiểm tra tính có thật của hàng hóa.",
          },
          output_risks: {
            total_invoices: 9,
            total_pretax: 144600000,
            total_vat: 14460000,
            total_payment: 159060000,
            invoices: [
              {
                id: 10,
                so_hd: "1",
                ky_hieu: "C24TPK",
                ngay: "2024-01-15",
                mst_mua: "0316764844",
                ten_mua: "CÔNG TY TNHH TM DV KHÁNH LỢI",
                tong_truoc_thue: 144600000,
                tong_thue: 14460000,
                tong_tien: 159060000,
                status: "DA_XUAT",
                is_in_524_list: true,
                current_status: "Trạng thái 06",
                safety_assessment: "AN TOÀN TUYỆT ĐỐI (ĐẦU RA)",
              },
            ],
            guidance: "INUT là bên nộp thuế, hoàn toàn an toàn.",
          },
          generated_at: new Date().toISOString(),
        },
      });
    }

    if (path === "/api/tax-defense/check-mst") {
      return route.fulfill({
        json: {
          mst: "0316764844",
          company_name: "CÔNG TY TNHH TM DV KHÁNH LỢI",
          address: "72/2A Nguyễn Thị Đành, Xã Xuân Thới Sơn, TP Hồ Chí Minh",
          status_code: "06",
          status_desc: "NNT không hoạt động tại địa chỉ đã đăng ký",
          is_active: false,
          is_abandoned: true,
          is_suspended: false,
          is_closed: false,
          risk_level: "high",
          defense_note: "Giao dịch bán hàng thực tế năm 2024, có hóa đơn cấp mã CQT hợp lệ.",
          referers: {},
        },
      });
    }

    return route.fulfill({ json: {} });
  });
}

test("renders TaxDefense page with KPI metrics and 4-year matrix", async ({ page }) => {
  await mockTaxDefense(page);
  await page.goto("/giai-trinh-thue");

  // Title and subtitle check
  await expect(page.getByRole("heading", { name: /Giải Trình Thuế & Thẩm Tra Doanh Thu/i })).toBeVisible();
  await expect(page.getByText(/KHÔNG PHỤ THUỘC TỒN KHO VẬT LÝ/i)).toBeVisible();

  // Metric card checks
  await expect(page.getByText(/Doanh thu chưa thuế \(4 năm\)/i)).toBeVisible();
  await expect(page.getByText(/Thuế GTGT đầu ra \(4 năm\)/i)).toBeVisible();
  await expect(page.getByText(/R&D & Just-In-Time/i)).toBeVisible();

  // Matrix rows check
  await expect(page.getByRole("cell", { name: "2022", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2023", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2024", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2025", exact: true }).first()).toBeVisible();
  // Switch to Cost Breakdown tab
  await page.getByRole("button", { name: /Cơ cấu Chi phí & Thuế mua/i }).click();
  await expect(page.getByText(/Phân Bổ Chi Phí Mua Vào & Thuế GTGT Đầu Vào Khấu Trừ/i)).toBeVisible();
  await expect(page.getByText(/Danh Mục Hóa Đơn Mua Vào >= 20 Triệu Đồng/i)).toBeVisible();

  // Switch to Dossier tab
  await page.getByRole("button", { name: /Thuyết minh Giải trình Pháp lý/i }).click();
  await expect(page.getByText(/Bản Thuyết Minh Giải Trình/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Sao Chép Toàn Văn/i })).toBeVisible();

  // Switch to Import tab
  await page.getByRole("button", { name: /Nạp Bảng kê Mua vào Excel/i }).click();
  await expect(page.getByRole("button", { name: /Bắt Đầu Nạp Bảng Kê/i })).toBeVisible();

  // Switch to Partners / Status 06 Audit tab
  await page.getByRole("button", { name: /Rà Soát MST & Bỏ Địa Chỉ/i }).click();
  await expect(page.getByText(/Cảnh báo Trạng thái 06/i).first()).toBeVisible();
  await expect(page.getByText(/Cổng Thông Tin Công Quyền Đối Chứng/i)).toBeVisible();
  await expect(page.getByText(/congkhaithongtin\.gdt\.gov\.vn/i)).toBeVisible();
  await expect(page.getByText("CÔNG TY TNHH TM DV KHÁNH LỢI").first()).toBeVisible();
  await expect(page.getByText("NNT không hoạt động tại địa chỉ đã đăng ký").first()).toBeVisible();

  // Click "Xem Giải Trình" button to verify defense modal
  await page.getByRole("button", { name: /Xem Giải Trình/i }).first().click();
  await expect(page.getByText(/Căn Cứ Giải Trình Bảo Vệ Pháp Lý/i)).toBeVisible();
  await expect(page.getByText(/Giao dịch bán hàng \(Đầu ra\)/i)).toBeVisible();
  await page.getByRole("button", { name: "Đóng" }).click();
});
