import { expect, test } from "@playwright/test";

const MOCK_ME = {
  username: "admin",
  role: "admin",
  customer_name: null,
  agent_default_ip: "127.0.0.1",
  default_location: "Hồ Chí Minh",
  using_default_secrets: false,
  must_change_password: false,
};

const MOCK_SEARCH_RESULTS = {
  items: [
    {
      tbmt_code: "IB2600001001-00",
      tender_name: "Cung cấp hệ thống giám sát năng lượng và IoT Gateway cho các trạm bơm tiêu",
      procuring_entity: "Công ty TNHH MTV Khai thác Thủy lợi Miền Nam",
      investor: "Sở Nông nghiệp và Phát triển Nông thôn TP. Hồ Chí Minh",
      field: "HH",
      bid_price: 980000000.0,
      bid_deadline: "2026-09-30 09:00:00",
      bid_opening_date: "2026-09-30 09:30:00",
      province: "Hồ Chí Minh",
      bidding_method: "Đấu thầu rộng rãi qua mạng",
      source_url: "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?notifyNo=IB2600001001-00",
      decision_number: "1042/QĐ-SNN",
      is_bookmarked: false,
      bookmark_id: null,
      bookmark_status: null,
    },
    {
      tbmt_code: "IB2600001002-00",
      tender_name: "Mua sắm và lắp đặt hệ thống SCADA giám sát tự động 12 trạm biến áp phân phối",
      procuring_entity: "Tổng Công ty Điện lực Miền Nam (EVNSPC)",
      investor: "Công ty Điện lực Bình Dương",
      field: "HH",
      bid_price: 2450000000.0,
      bid_deadline: "2026-10-05 14:00:00",
      bid_opening_date: "2026-10-05 14:30:00",
      province: "Bình Dương",
      bidding_method: "Đấu thầu rộng rãi qua mạng",
      source_url: "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?notifyNo=IB2600001002-00",
      decision_number: "589/QĐ-PCBD",
      is_bookmarked: true,
      bookmark_id: 1,
      bookmark_status: "watching",
    },
  ],
  total: 2,
  page: 1,
  page_size: 10,
  total_pages: 1,
  is_mock: true,
};

const MOCK_CONTRACTOR_CRM_SCAN = {
  total_crm_customers: 7,
  total_won_contractors: 5,
  total_won_value_vnd: 103570000000.0,
  total_won_value_formatted: "103.570.000.000 ₫",
  items: [
    {
      customer_id: 1,
      tax_code: "0105365128",
      name: "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU",
      short_name: "Gdata",
      address: "Hà Nội",
      email: "contact@gdata.vn",
      bidding_status: "WON_BIG",
      bidding_status_label: "🏆 Trúng Thầu Nhiều",
      total_bids: 14,
      total_won: 11,
      total_lost: 2,
      total_evaluating: 1,
      win_rate_percent: 78.6,
      total_won_value_vnd: 12580000000.0,
      total_won_value_formatted: "12.580.000.000 ₫",
      average_discount_percent: 4.8,
      top_procuring_entities: [
        "Tổng cục Tiêu chuẩn Đo lường Chất lượng",
        "Báo điện tử Đảng Cộng sản Việt Nam",
        "Tổng cục Hải quan",
      ],
      highlight_won_packages: [
        {
          tbmt_code: "IB2500094821-00",
          tender_name: "Xây dựng trục tích hợp, nâng cấp phần mềm tác nghiệp giải quyết TTHC và Cổng TTĐT",
          procuring_entity: "Tổng cục Tiêu chuẩn Đo lường Chất lượng",
          bid_price: 5600000000.0,
          won_price: 5507000000.0,
          discount_percent: 1.66,
          award_date: "2025-11-15",
          decision_number: "1840/QĐ-TĐC",
          status: "WON",
        },
        {
          tbmt_code: "IB2400182940-00",
          tender_name: "Thuê dịch vụ công nghệ thông tin hạ tầng cổng thông tin và máy chủ tác nghiệp",
          procuring_entity: "Báo điện tử Đảng Cộng sản Việt Nam",
          bid_price: 3350000000.0,
          won_price: 3260040000.0,
          discount_percent: 2.68,
          award_date: "2024-12-20",
          decision_number: "412/QĐ-BĐTĐCSVN",
          status: "WON",
        },
      ],
      ai_insight: "Gdata có năng lực rất mạnh trong các gói thầu cung cấp hạ tầng máy chủ, đường truyền dữ liệu và trục tích hợp CNTT cấp Bộ/Tổng cục. INUT có thể đóng vai trò OEM/nhà cung cấp thiết bị Gateway IoT.",
    },
    {
      customer_id: 2,
      tax_code: "2800817718",
      name: "CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG",
      short_name: "Tân Thanh Phương",
      address: "Thanh Hóa",
      email: "info@tanthanhphuong.vn",
      bidding_status: "WON_BIG",
      bidding_status_label: "🏆 Trúng Thầu Lớn",
      total_bids: 9,
      total_won: 7,
      total_lost: 2,
      total_evaluating: 0,
      win_rate_percent: 77.8,
      total_won_value_vnd: 18450000000.0,
      total_won_value_formatted: "18.450.000.000 ₫",
      average_discount_percent: 3.2,
      top_procuring_entities: [
        "Sở Thông tin và Truyền thông Thanh Hóa",
        "Trung tâm Công nghệ thông tin tỉnh Thanh Hóa",
      ],
      highlight_won_packages: [
        {
          tbmt_code: "IB2400031920-00",
          tender_name: "Gói thầu số 08: Cung cấp, lắp đặt thiết bị công nghệ Trung tâm CNTT",
          procuring_entity: "Sở Thông tin và Truyền thông Thanh Hóa",
          bid_price: 9100000000.0,
          won_price: 8885453000.0,
          discount_percent: 2.36,
          award_date: "2024-08-18",
          decision_number: "512/QĐ-STTTT",
          status: "WON",
        },
      ],
      ai_insight: "Tân Thanh Phương là nhà thầu công nghệ trụ cột tại khu vực Bắc Trung Bộ. Cơ hội lớn đưa giải pháp Smart City và Datalogger thủy lợi.",
    },
    {
      customer_id: 3,
      tax_code: "4401053694",
      name: "CÔNG TY TNHH CÔNG NGHỆ INUT",
      short_name: "iNut Technology",
      address: "TP. Hồ Chí Minh",
      email: "contact@inut.vn",
      bidding_status: "INUT_HQ",
      bidding_status_label: "🌟 INUT (Đơn Vị Chủ Quản)",
      total_bids: 6,
      total_won: 4,
      total_lost: 1,
      total_evaluating: 1,
      win_rate_percent: 66.7,
      total_won_value_vnd: 3450000000.0,
      total_won_value_formatted: "3.450.000.000 ₫",
      average_discount_percent: 5.2,
      top_procuring_entities: ["Trung tâm Ứng dụng Tiến bộ KH&CN", "Sở Nông nghiệp và PTNT"],
      highlight_won_packages: [],
      ai_insight: "Hồ sơ năng lực nhà thầu công nghệ cao, R&D thiết bị IoT Gateway, Datalogger đạt chuẩn Thông tư 10/BTNMT.",
    },
    {
      customer_id: 4,
      tax_code: "5500649200",
      name: "CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HOÁ IOT",
      short_name: "Tự Động Hóa IoT",
      address: "Sơn La",
      email: "iot@sonla.vn",
      bidding_status: "REGISTERED_BIDDER",
      bidding_status_label: "📝 Đã Đăng Ký Nhà Thầu",
      total_bids: 4,
      total_won: 2,
      total_lost: 1,
      total_evaluating: 1,
      win_rate_percent: 50.0,
      total_won_value_vnd: 890000000.0,
      total_won_value_formatted: "890.000.000 ₫",
      average_discount_percent: 4.2,
      top_procuring_entities: ["Công ty Điện lực Sơn La"],
      highlight_won_packages: [],
      ai_insight: "Doanh nghiệp tự động hóa tiềm năng tại vùng Tây Bắc. Phù hợp làm đại lý triển khai lắp đặt tại chỗ.",
    },
    {
      customer_id: 5,
      tax_code: "0314360282",
      name: "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ KỸ THUẬT BẢO TOÀN",
      short_name: "Bảo Toàn Tech",
      address: "TP. Hồ Chí Minh",
      email: "baotoan@tech.vn",
      bidding_status: "OEM_SUBCONTRACTOR",
      bidding_status_label: "⚙️ Nhà Thầu Phụ / OEM Tủ Điện",
      total_bids: 0,
      total_won: 0,
      total_lost: 0,
      total_evaluating: 0,
      win_rate_percent: 0.0,
      total_won_value_vnd: 0.0,
      total_won_value_formatted: "0 ₫",
      average_discount_percent: 0.0,
      top_procuring_entities: ["Các Tổng Thầu Xây Lắp Điện & SCADA"],
      highlight_won_packages: [],
      ai_insight: "Bảo Toàn Tech là đối tác sản xuất tủ bảng điện MSB/DB/ATS công nghiệp chất lượng cao, thường đóng vai trò nhà thầu phụ (Subcontractor/OEM).",
    },
  ],
};

const MOCK_BOOKMARKS = [
  {
    id: 1,
    tbmt_code: "IB2600001001-00",
    tender_name: "Cung cấp hệ thống giám sát năng lượng và IoT Gateway cho các trạm bơm tiêu",
    procuring_entity: "Công ty TNHH MTV Khai thác Thủy lợi Miền Nam",
    investor: "Sở Nông nghiệp và Phát triển Nông thôn TP. Hồ Chí Minh",
    field: "HH",
    bid_price: 980000000.0,
    bid_deadline: "2026-09-30 09:00:00",
    bid_opening_date: "2026-09-30 09:30:00",
    province: "Hồ Chí Minh",
    bidding_method: "Đấu thầu rộng rãi qua mạng",
    source_url: "https://muasamcong.mpi.gov.vn/...",
    status: "watching",
    note: "AI chấm 95 điểm - cơ hội rất lớn",
    ai_summary: JSON.stringify({
      inut_fit_analysis: {
        score: 95,
        match_level: "Cao",
        strengths: ["Làm chủ công nghệ Gateway"],
        recommendation: "Nên tham gia độc lập",
      },
    }),
    created_by: 1,
    created_at: "2026-08-20T10:00:00Z",
    updated_at: "2026-08-20T10:00:00Z",
  },
];

const MOCK_WATCHLISTS = [
  {
    id: 1,
    name: "Giám sát SCADA & IoT Miền Nam",
    keyword: "SCADA",
    province: "Hồ Chí Minh",
    field: "HH",
    min_price: 500000000.0,
    max_price: 3000000000.0,
    method: "Đấu thầu rộng rãi qua mạng",
    notify_telegram: true,
    is_active: true,
    last_checked_at: "2026-08-22T08:00:00Z",
    created_by: 1,
    created_at: "2026-08-20T10:00:00Z",
    updated_at: "2026-08-20T10:00:00Z",
  },
];

test.beforeEach(async ({ page }) => {
  // Mock Auth
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: MOCK_ME })
  );

  // Mock Search
  await page.route("**/api/bidding/search*", (route) =>
    route.fulfill({ json: MOCK_SEARCH_RESULTS })
  );

  // Mock Tender Detail
  await page.route("**/api/bidding/tenders/IB2600001001-00", (route) =>
    route.fulfill({
      json: {
        ...MOCK_SEARCH_RESULTS.items[0],
        description: "Mua sắm 25 bộ Gateway iNut 4G Modbus, 50 cảm biến đo mức nước siêu âm.",
        bid_validity_period_days: 90,
        execution_period_days: 45,
      },
    })
  );

  // Mock HTML Preview
  await page.route("**/api/bidding/tenders/*/html-preview", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!DOCTYPE html><html><body><h1>MẠNG ĐẤU THẦU QUỐC GIA</h1><p>IB2600001001-00</p></body></html>",
    })
  );

  // Mock AI Analyze
  await page.route("**/api/bidding/tenders/*/analyze-ai", (route) =>
    route.fulfill({
      json: {
        tbmt_code: "IB2600001001-00",
        analysis: {
          executive_summary: "Gói thầu cung cấp thiết bị IoT SCADA trạm bơm.",
          scope_of_work: ["Cung cấp 25 bộ Gateway iNut 4G", "Lắp đặt cảm biến đo mức nước"],
          capacity_requirements: ["ISO 9001:2015", "02 hợp đồng tương tự"],
          financial_requirements: { min_annual_revenue: 2000000000.0, summary: "Doanh thu tối thiểu 2 tỷ" },
          inut_fit_analysis: {
            score: 95,
            match_level: "Cao",
            strengths: ["Làm chủ công nghệ Gateway"],
            challenges: ["Thời gian chuẩn bị 18 ngày"],
            recommendation: "Nên tham gia độc lập",
            strategic_action_plan: "1. Khảo sát hiện trường; 2. Nộp E-HSDT",
          },
        },
        saved_to_bookmark: false,
      },
    })
  );

  // Mock Bookmarks
  await page.route("**/api/bidding/bookmarks*", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        json: {
          id: 99,
          ...route.request().postDataJSON(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    }
    return route.fulfill({
      json: {
        items: MOCK_BOOKMARKS,
        total: MOCK_BOOKMARKS.length,
      },
    });
  });

  // Mock Watchlist
  await page.route("**/api/bidding/watchlist*", (route) =>
    route.fulfill({
      json: {
        items: MOCK_WATCHLISTS,
        total: MOCK_WATCHLISTS.length,
      },
    })
  );

  // Mock Contractor CRM Scan
  await page.route("**/api/bidding/contractors/crm-scan", (route) =>
    route.fulfill({ json: MOCK_CONTRACTOR_CRM_SCAN })
  );

  // Mock Contractor Search
  await page.route("**/api/bidding/contractors/search*", (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get("query") || "").toLowerCase();
    const filtered = MOCK_CONTRACTOR_CRM_SCAN.items.filter(
      (i) => i.name.toLowerCase().includes(query) || i.tax_code.includes(query) || i.short_name.toLowerCase().includes(query)
    );
    return route.fulfill({ json: filtered });
  });

  // Mock Contractor Profile by Tax Code
  await page.route("**/api/bidding/contractors/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    const tax = path.split("/").pop() || "";
    const contractor = MOCK_CONTRACTOR_CRM_SCAN.items.find((i) => i.tax_code === tax) || MOCK_CONTRACTOR_CRM_SCAN.items[0];
    return route.fulfill({ json: contractor });
  });
});

test("E2E-1: Bidding Cockpit Header and Tab Navigation", async ({ page }) => {
  await page.goto("/dau-thau");

  // Verify Hero Title
  await expect(page.getByRole("heading", { name: "Săn Gói Thầu & Phân Tích E-HSMT Bằng AI" })).toBeVisible();
  await expect(page.getByText("MST 4401053694")).toBeVisible();

  // Verify 4 Main Tabs exist
  const searchTab = page.getByRole("button", { name: /Tra Cứu Gói Thầu/i });
  const bookmarksTab = page.getByRole("button", { name: /Gói Thầu Quan Tâm/i });
  const contractorsTab = page.getByRole("button", { name: /Năng Lực Nhà Thầu & Khách Hàng CRM/i });
  const watchlistTab = page.getByRole("button", { name: /Bộ Lọc Tự Động & Cảnh Báo/i });

  await expect(searchTab).toBeVisible();
  await expect(bookmarksTab).toBeVisible();
  await expect(contractorsTab).toBeVisible();
  await expect(watchlistTab).toBeVisible();

  // Switch to Tab 2: Bookmarks
  await bookmarksTab.click();
  await expect(page.getByText("Danh Sách Gói Thầu Quan Tâm (Pipeline)").first()).toBeVisible();

  // Switch to Tab 4: Watchlist
  await watchlistTab.click();
  await expect(page.getByRole("heading", { name: "Quy Tắc Săn Gói Thầu Tự Động" })).toBeVisible();

  // Switch to Tab 3: Contractors & CRM
  await contractorsTab.click();
  await expect(page.getByRole("heading", { name: "Hồ Sơ Năng Lực Nhà Thầu & Đối Soát Khách Hàng CRM" })).toBeVisible();
});

test("E2E-2: Live Search and Filter Controls", async ({ page }) => {
  await page.goto("/dau-thau");

  const searchInput = page.getByPlaceholder(/Nhập tên gói thầu, số TBMT/i);
  await expect(searchInput).toBeVisible();
  await searchInput.fill("SCADA");

  const searchBtn = page.getByRole("button", { name: "Tìm Kiếm Gói Thầu" });
  await searchBtn.click();

  // Verify search result cards
  await expect(page.getByText("IB2600001001-00").first()).toBeVisible();
  await expect(page.getByText("Cung cấp hệ thống giám sát năng lượng").first()).toBeVisible();

  // Toggle Advanced Filters
  const advancedBtn = page.getByRole("button", { name: /Bộ lọc nâng cao/i });
  await advancedBtn.click();

  await expect(page.getByText("Tất cả lĩnh vực")).toBeVisible();
});

test("E2E-3: Contractor Intelligence & CRM Scan Cockpit", async ({ page }) => {
  await page.goto("/dau-thau");

  // Navigate to Contractors tab
  await page.getByRole("button", { name: /Năng Lực Nhà Thầu & Khách Hàng CRM/i }).click();

  // Verify 4 Macro Stat Cards
  await expect(page.getByText("Tổng Khách Hàng CRM")).toBeVisible();
  await expect(page.getByText("Khách Hàng Trúng Thầu")).toBeVisible();
  await expect(page.getByText("Tổng Giá Trị Trúng Thầu")).toBeVisible();
  await expect(page.getByText("Nhà Thầu Công Nghệ / OEM")).toBeVisible();

  // Verify Macro Values from mock
  await expect(page.getByText("103.570.000.000 ₫")).toBeVisible();

  // Check Contractor Cards rendered
  await expect(page.getByRole("heading", { name: "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CÔNG TY TNHH CÔNG NGHỆ INUT" })).toBeVisible();

  // Check Win Rate and Badges
  await expect(page.getByText("78.6%").first()).toBeVisible();
  await expect(page.getByText("🏆 Trúng Thầu Nhiều").first()).toBeVisible();
  await expect(page.getByText("🌟 INUT (Đơn Vị Chủ Quản)").first()).toBeVisible();

  // Test Quick Suggestion Buttons
  const inutQuickBtn = page.getByRole("button", { name: /iNut Technology \(4401053694\)/i });
  await expect(inutQuickBtn).toBeVisible();
  await inutQuickBtn.click();
});

test("E2E-4: Contractor Dossier Modal with Won Packages Drill-down", async ({ page }) => {
  await page.goto("/dau-thau");
  await page.getByRole("button", { name: /Năng Lực Nhà Thầu & Khách Hàng CRM/i }).click();

  // Click "Xem Chi Tiết Hồ Sơ" on Gdata card
  const detailButtons = page.getByRole("button", { name: /Xem Chi Tiết Hồ Sơ/i });
  await detailButtons.first().click();

  // Verify Dossier Modal is opened
  await expect(page.getByText("Danh Sách Gói Thầu Tiêu Biểu & Quyết Định Phê Duyệt")).toBeVisible();
  await expect(page.getByText("IB2500094821-00")).toBeVisible();
  await expect(page.getByText("1840/QĐ-TĐC (2025-11-15)")).toBeVisible();
  await expect(page.getByText("Đánh Giá Chiến Lược & Cơ Hội Hợp Tác Bằng AI:")).toBeVisible();

  // Close modal
  const closeButton = page.getByRole("button", { name: "✕" }).first();
  await closeButton.click();
  await expect(page.getByText("Danh Sách Gói Thầu Tiêu Biểu & Quyết Định Phê Duyệt")).toHaveCount(0);
});

test("E2E-5: AI Evaluation Modal Trigger", async ({ page }) => {
  await page.goto("/dau-thau");

  // In search tab, click "AI Phân Tích E-HSMT" on the first tender card
  const aiBtn = page.getByRole("button", { name: /AI Phân Tích/i }).first();
  if (await aiBtn.isVisible()) {
    await aiBtn.click();

    // Verify AI analysis modal displays
    await expect(page.getByText("Đánh Giá Độ Tương Thích Với Năng Lực INUT")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Nên tham gia độc lập")).toBeVisible();
  }
});

test("E2E-6: Responsive Mobile Viewport Layout", async ({ page }) => {
  // Set viewport to mobile size
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/dau-thau");

  // Verify responsive navigation tabs
  const searchTab = page.getByRole("button", { name: /Tra Cứu/i }).first();
  await expect(searchTab).toBeVisible();

  // Verify input is responsive
  const searchInput = page.getByPlaceholder(/Nhập tên gói thầu/i);
  await expect(searchInput).toBeVisible();
});
