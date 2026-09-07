import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const MOCK_ORDERS = [
  {
    id: 101,
    tracking_no: "SPXVN069813371898",
    order_code: "VN2615337004838260",
    recipient_name: "Nguyễn Văn A",
    recipient_phone: "0901234567",
    recipient_address: "123 Lê Lợi, Phường Bến Nghé",
    province: "TP. Hồ Chí Minh",
    district: "Quận 1",
    ward: "Phường Bến Nghé",
    cod_amount: 350000,
    weight_gram: 500,
    length_cm: 20,
    width_cm: 15,
    height_cm: 10,
    item_description: "Bộ điều khiển iNut Sensor SCADA",
    status: "READY_TO_SHIP",
    shipping_fee: 28000,
    label_doc_id: 12,
    is_printed: false,
    printed_at: null,
    created_at: "2026-08-22T14:30:00Z",
  },
  {
    id: 102,
    tracking_no: "SPXVN088219482910",
    order_code: "VN2615337004839999",
    recipient_name: "Trần Thị B",
    recipient_phone: "0987654321",
    recipient_address: "456 Trần Phú",
    province: "Đà Nẵng",
    district: "Hải Châu",
    ward: "Hải Châu 1",
    cod_amount: 0,
    weight_gram: 250,
    length_cm: 15,
    width_cm: 10,
    height_cm: 5,
    item_description: "Module Relay KSP Pro",
    status: "READY_TO_SHIP",
    shipping_fee: 22000,
    label_doc_id: 13,
    is_printed: true,
    printed_at: "2026-08-22T15:10:00Z",
    created_at: "2026-08-22T12:00:00Z",
  },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        username: "admin",
        role: "admin",
        customer_name: null,
        agent_default_ip: "",
        default_location: "",
        using_default_secrets: false,
        must_change_password: false,
        training_access: true,
      },
    })
  );

  await page.route("**/api/spx/orders*", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          items: MOCK_ORDERS,
          total: 2,
          page: 1,
          page_size: 100,
          unprinted_count: 1,
          printed_count: 1,
        },
      });
    }
    return route.continue();
  });

  await page.route("**/api/spx/quick-print", (route) =>
    route.fulfill({
      json: {
        success: true,
        message: "Đã in tem thành công sang máy in TP732H tại 192.168.1.10!",
        tracking_no: "SPXVN069813371898",
        status: "PRINTED",
        is_printed: true,
      },
    })
  );

  await page.route("**/api/spx/sync-orders", (route) =>
    route.fulfill({
      json: {
        success: true,
        total_synced: 3,
        message: "Đã đồng bộ thành công 3 mã vận đơn!",
        tracking_numbers: ["SPXVN069813371898", "SPXVN088219482910", "VN2615337004838260"],
      },
    })
  );
});

test("renders INUT Operations Dark Emerald header and stats cards", async ({ page }) => {
  await page.goto("/shipping-spx");

  // Verify Header
  await expect(page.getByRole("heading", { name: "Đồng Bộ & In Vận Đơn SPX" })).toBeVisible();
  await expect(page.getByText("SPX Express")).toBeVisible();
  await expect(page.getByText(/Máy TP732H \(192\.168\.1\.158\)/)).toBeVisible();

  // Verify Quick Print Bar with 65% Align Right badge
  await expect(page.getByText("Tỉ Lệ Vàng 65% Lệch Phải")).toBeVisible();
  await expect(page.getByPlaceholder(/Nhập hoặc dùng máy quét Barcode/)).toBeVisible();

  // Verify 3 Stats Cards
  await expect(page.getByText("Tổng Vận Đơn")).toBeVisible();
  await expect(page.getByText("🔴 Chưa In Tem")).toBeVisible();
  await expect(page.getByText("🟢 Đã In Tem")).toBeVisible();
});

test("supports sound toggle and auto-print switch", async ({ page }) => {
  await page.goto("/shipping-spx");

  // Sound toggle
  const soundBtn = page.getByTitle(/Bật\/Tắt âm thanh Bíp/);
  await expect(soundBtn).toBeVisible();
  await soundBtn.click();

  // Auto-print toggle
  const autoPrintCheckbox = page.getByLabel(/Tự động in ngay khi quét/);
  await expect(autoPrintCheckbox).toBeVisible();
  await autoPrintCheckbox.click();
});

test("quick print bar submits tracking number and displays success alert", async ({ page }) => {
  await page.goto("/shipping-spx");

  const input = page.getByPlaceholder(/Nhập hoặc dùng máy quét Barcode/);
  await input.fill("SPXVN069813371898");

  const printBtn = page.getByRole("button", { name: /In Máy TP732H/ });
  await expect(printBtn).toBeEnabled();
  await printBtn.click();

  await expect(page.getByText(/Đã in tem thành công sang máy in TP732H/)).toBeVisible();
});

test("opens batch sync modal and accepts bulk tracking numbers", async ({ page }) => {
  await page.goto("/shipping-spx");

  const syncBtn = page.getByRole("button", { name: /Nhập \/ Đồng Bộ Đơn/ });
  await syncBtn.click();

  await expect(page.getByRole("heading", { name: "Đồng Bộ & Nhập Mã Đơn SPX" })).toBeVisible();

  const textarea = page.getByPlaceholder(/Dán danh sách mã vận đơn/);
  await textarea.fill("SPXVN069813371898\nSPXVN088219482910\nVN2615337004838260");

  const submitBtn = page.getByRole("button", { name: /Đồng Bộ Ngay/ });
  await submitBtn.click({ force: true });

  await expect(page.getByText(/Đã đồng bộ thành công 3 mã vận đơn/)).toBeVisible();
});

test("clicking tracking number opens label preview modal with iframe", async ({ page }) => {
  await page.goto("/shipping-spx");

  // Click tracking number in table
  const trackingLink = page.locator(".spx-tracking-link").first();
  await trackingLink.click({ force: true });

  // Modal appears
  const modal = page.locator(".spx-modal-card");
  await expect(modal.getByText("Chi Tiết Vận Đơn & Nhãn In SPX")).toBeVisible();
  await expect(modal.getByText("Nguyễn Văn A")).toBeVisible();
  await expect(modal.getByText(/350\.000/)).toBeVisible();

  // Verify label iframe container exists
  await expect(page.getByText("Xem trước nhãn tem in A6/nhiệt:")).toBeVisible();
  await expect(page.locator("iframe")).toBeVisible();
});

test("passes WCAG 2.1 AA automated accessibility audit on desktop and mobile", async ({ page }) => {
  await page.goto("/shipping-spx");

  const mainResults = await new AxeBuilder({ page })
    .include(".spx-page")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["frame-tested"])
    .analyze();

  expect(mainResults.violations).toEqual([]);
});
