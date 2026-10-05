import { expect, test } from "@playwright/test";

const mockContract = {
  id: 1,
  contractor_id: 1,
  contract_code: "01/2026/HĐGK-DONGSON",
  contract_type: "thi_cong",
  title: "Hợp đồng giao khoán thi công lắp đặt Kiosk VNMAP AI ONE tại UBND Phường Đông Sơn",
  project_name: "Kiosk VNMAP AI ONE - Phường Đông Sơn",
  location: "UBND Phường Đông Sơn, TP. Thanh Hóa",
  contract_date: "2026-09-28",
  worker_name: "Lê Văn Hải",
  worker_id_card: "038092004512",
  worker_phone: "0961 197 999",
  worker_bank_account: "19034567891011",
  worker_bank_name: "Techcombank",
  total_amount: 4500000,
  tax_rate: 0,
  tax_amount: 0,
  net_amount: 4500000,
  is_signed_by_worker: true,
  worker_signed_at: "2026-09-29T16:30:00Z",
  worker_signature_data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  worker_face_photo_data: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  worker_face_doc_id: "face123",
  is_signed_by_inut: true,
  inut_signed_at: "2026-09-28T09:00:00Z",
  portal_token: "dongson-kiosk-token-849200",
  pdf_doc_id: "pdf123",
  deficiency: {
    contract_code: "01/2026/HĐGK-DONGSON",
    worker_name: "Lê Văn Hải",
    status_code: "ready_to_pay",
    status_label: "🟢 Đủ điều kiện thanh toán",
    missing_count: 0,
    can_pay: true,
    is_sub_5m: true,
    checklist: [
      { key: "id_card", label: "CCCD 2 mặt", ok: true, detail: "Đã có CCCD 2 mặt" },
      { key: "bank_account", label: "STK chính chủ", ok: true, detail: "19034567891011 tại Techcombank" },
      { key: "acceptance", label: "Biên bản nghiệm thu", ok: true, detail: "Đã có nghiệm thu" },
      { key: "tax_docs", label: "Hồ sơ thuế TNCN", ok: true, detail: "Miễn trừ 10% TNCN (dưới 5 triệu)" },
      { key: "worker_sig", label: "Chữ ký online của thợ", ok: true, detail: "Thợ đã ký" },
      { key: "inut_sig", label: "Chữ ký số INUT", ok: true, detail: "Bên A đã ký" },
      { key: "bank_unc", label: "Chứng từ chuyển khoản (UNC)", ok: false, detail: "Chưa kẹp UNC ngân hàng" },
    ],
  },
  attachments: {
    id_card_front: { doc_id: "idf1", label: "CCCD Mặt trước", url: "/api/piecework/docs/idf1/file", is_pdf: false, validation: { valid: true } },
    id_card_back: { doc_id: "idb1", label: "CCCD Mặt sau", url: "/api/piecework/docs/idb1/file", is_pdf: false, validation: { valid: true } },
    acceptance: { doc_id: "acc1", label: "Biên bản nghiệm thu", url: "/api/piecework/docs/acc1/file", is_pdf: true, validation: { valid: true } },
    worker_face: { doc_id: "face123", label: "Ảnh chân dung xác thực lúc ký (eKYC)", url: "/api/piecework/docs/face123/file", is_pdf: false, validation: { valid: true } },
    site_photos: [],
  },
};

const mockContractor = {
  id: 1,
  code: "CTV-HAI-4512",
  name: "Lê Văn Hải",
  id_card: "038092004512",
  id_card_date: "2022-04-15",
  id_card_place: "Cục Cảnh sát QLHC về TTXH",
  tax_code: "8492004512",
  phone: "0961 197 999",
  address: "Tổ 2, Phường Đông Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa",
  bank_account: "19034567891011",
  bank_name: "Techcombank",
  skills: "Lắp đặt Kiosk VNMAP AI, căn chỉnh tủ điện, thiết bị đọc thẻ CCCD",
  notes: "Nhà cung cấp khoán thi công Thanh Hóa quen thuộc",
  id_card_front_doc_id: "idf1",
  id_card_back_doc_id: "idb1",
  has_id_card_front: true,
  has_id_card_back: true,
  contracts_count: 1,
  total_gross: 4500000,
  total_tax: 0,
  total_net: 4500000,
  last_contract_date: "2026-09-28",
};

const mockTaxSummary = {
  ok: true,
  year: 2026,
  contractor: {
    id: 1,
    code: "CTV-HAI-4512",
    name: "Lê Văn Hải",
    id_card: "038092004512",
    id_card_date: "2022-04-15",
    id_card_place: "Cục Cảnh sát QLHC về TTXH",
    tax_code: "8492004512",
    phone: "0961 197 999",
    address: "Tổ 2, Phường Đông Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa",
    bank_account: "19034567891011",
    bank_name: "Techcombank",
  },
  payer: {
    company_name: "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
    tax_code: "4401053694",
    address: "161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk",
  },
  summary: {
    total_contracts: 1,
    total_gross_income: 4500000,
    total_tax_withheld: 0,
    total_net_paid: 4500000,
  },
  contracts: [
    {
      stt: 1,
      contract_code: "01/2026/HĐGK-DONGSON",
      contract_date: "2026-09-28",
      project_name: "Kiosk VNMAP AI ONE - Phường Đông Sơn",
      contract_type_label: "Thi công lắp đặt",
      gross_amount: 4500000,
      tax_rate: 0,
      tax_withheld: 0,
      net_paid: 4500000,
      has_unc: false,
      is_signed_by_inut: true,
      pdf_url: "/api/public/khoan/dongson-kiosk-token-849200/pdf?signed=1",
    },
  ],
  legal_bases: [
    "Khoản 2 Điều 50 Nghị định số 253/2026/NĐ-CP",
    "Thông tư 111/2013/TT-BTC",
    "Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC",
  ],
  tax_refund_guidance: "Căn cứ làm thủ tục Quyết toán / Hoàn thuế TNCN tại Chi cục Thuế.",
};

const mockCertificates = [
  {
    id: "6616B8A61F228D0EAFF8AAF5F44F3ECD660DD8CD",
    subject: "CN=CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT, OID.0.9.2342.19200300.100.1.1=MST:4401053694, C=VN",
    issuer: "CN=WINCA CA, O=CÔNG TY TNHH WINGROUP, C=VN",
    serial: "540116541CB8AAF5",
    valid_from: "2024-06-15T00:00:00Z",
    valid_to: "2027-06-15T23:59:59Z",
    expired: false,
    is_default: true,
    source: "token_winca",
  },
];

const mockVerifyResult = {
  ok: true,
  has_signature: true,
  intact: true,
  valid: true,
  signer_name: "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
  signer_tax_code: "4401053694",
  ca_issuer: "WINCA / WINGROUP CA",
  cert_serial: "212E27F75273863A0B43B67E9753B717DE6D097E",
  valid_from: "2024-06-15T00:00:00Z",
  valid_to: "2027-06-15T23:59:59Z",
  sign_date_m: "D:20260928090000",
  signing_time: "2026-09-28T09:00:00+00:00",
  subfilter: "ETSI.CAdES.detached",
  digest_algorithm: "SHA-256",
  signature_algorithm: "RSA (2048 bits) with SHA-256",
  tax_compliance: {
    compliant: true,
    signer_mst: "4401053694",
    signer_org: "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
    ca_issuer: "WINCA / WINGROUP CA",
    cert_serial: "212E27F75273863A0B43B67E9753B717DE6D097E",
    valid_from: "2024-06-15T00:00:00Z",
    valid_to: "2027-06-15T23:59:59Z",
    digest_algorithm: "SHA-256",
    signature_algorithm: "RSA (2048 bits) with SHA-256",
    subfilter: "ETSI.CAdES.detached",
    document_integrity: "Toàn vẹn (Không bị thay đổi, chỉnh sửa sau khi ký)",
    legal_bases: [
      "Luật Giao dịch điện tử số 20/2023/QH15",
      "Nghị định 130/2018/NĐ-CP",
      "Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC",
      "Nghị định 253/2026/NĐ-CP",
    ],
    foxit_reader_verdict: "Valid signature, document was not modified after this signature was applied",
    tax_authority_status: "ĐỦ ĐIỀU KIỆN PHÁP LÝ HỒ SƠ QUYẾT TOÁN THUẾ & GIẢI TRÌNH THANH TRA",
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/me") {
      return route.fulfill({
        json: {
          username: "admin",
          role: "admin",
          customer_name: null,
          agent_default_ip: "",
          default_location: "",
          using_default_secrets: false,
          must_change_password: false,
        },
      });
    }

    if (path === "/api/piecework/contracts") {
      return route.fulfill({
        json: {
          contracts: [mockContract],
          summary: { total: 1, pending_docs: 0, ready_to_pay: 1, completed: 0, total_amount: 4500000 },
        },
      });
    }

    if (path === "/api/piecework/contracts/1") {
      return route.fulfill({ json: mockContract });
    }

    if (path === "/api/piecework/contractors") {
      return route.fulfill({ json: { contractors: [mockContractor], total: 1 } });
    }

    if (path === "/api/piecework/contractors/1") {
      return route.fulfill({ json: { ...mockContractor, contracts: [mockContract], total_contracts: 1 } });
    }

    if (path === "/api/piecework/contractors/1/tax-summary") {
      return route.fulfill({ json: mockTaxSummary });
    }

    if (path === "/api/piecework/contractors/parse-text") {
      return route.fulfill({
        json: {
          ok: true,
          parsed: {
            name: "Lê Văn Hải",
            id_card: "038092004512",
            id_card_date: "2022-04-15",
            id_card_place: "Cục Cảnh sát QLHC về TTXH",
            tax_code: "8492004512",
            phone: "0961 197 999",
            address: "Tổ 2, Phường Đông Sơn, TP. Thanh Hóa",
            bank_account: "19034567891011",
            bank_name: "Techcombank",
          },
        },
      });
    }

    if (path === "/api/piecework/certificates") {
      return route.fulfill({ json: { certificates: mockCertificates, default_id: mockCertificates[0].id } });
    }

    if (path === "/api/piecework/contracts/1/verify-signature") {
      return route.fulfill({ json: mockVerifyResult });
    }

    if (path === "/api/piecework/contracts/1/validate") {
      return route.fulfill({
        json: {
          ok: true,
          contract_code: mockContract.contract_code,
          worker_name: mockContract.worker_name,
          deficiency: mockContract.deficiency,
          can_pay: true,
          status_code: "ready_to_pay",
          status_label: "🟢 Đủ điều kiện thanh toán",
          attachments: mockContract.attachments,
          worker_signature_data: mockContract.worker_signature_data,
          worker_face_photo_data: mockContract.worker_face_photo_data,
        },
      });
    }

    return route.fulfill({ json: {} });
  });
});

test("piecework contracts page adapts layout, contractor directory and touch targets across desktop and mobile", async ({ page }, testInfo) => {
  await page.goto("/hop-dong-khoan");

  // Verify page title and header
  await expect(page.getByRole("heading", { name: "Quản Lý Hợp Đồng Giao Khoán & Hồ Sơ Thợ/CTV" })).toBeVisible();
  await expect(page.getByRole("button", { name: "＋ Tạo HĐ Khoán Mới" })).toBeVisible();
  await expect(page.getByRole("button", { name: "👥 Thêm Nhà Cung Cấp" })).toBeVisible();
  await expect(page.getByRole("button", { name: "⚡ Smart Paste" })).toBeVisible();

  // Check navigation tabs exist
  const tabContracts = page.getByRole("button", { name: /Danh Sách Hợp Đồng Khoán/i });
  const tabContractors = page.getByRole("button", { name: /Danh Bạ Nhà Cung Cấp \/ Thợ/i });
  await expect(tabContracts).toBeVisible();
  await expect(tabContractors).toBeVisible();

  // Check no horizontal page overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  if (testInfo.project.name === "desktop") {
    // Desktop: Table must be visible, cards must be hidden
    const desktopTable = page.locator(".piecework-desktop-table");
    await expect(desktopTable).toBeVisible();
    await expect(desktopTable.locator("table")).toBeVisible();
    await expect(page.locator(".piecework-mobile-cards")).toBeHidden();

    // Verify contract row in desktop table
    await expect(desktopTable.getByText("01/2026/HĐGK-DONGSON")).toBeVisible();
    await expect(desktopTable.getByText("Lê Văn Hải")).toBeVisible();

    // Open Foxit & Tax Verification Modal
    const verifyBtn = desktopTable.getByRole("button", { name: /Thẩm định Chữ ký số/i });
    await expect(verifyBtn).toBeVisible();
    await verifyBtn.click();

    // Verify modal elements
    const verifyModal = page.locator(".piecework-modal-box");
    await expect(verifyModal).toBeVisible();
    await expect(verifyModal.getByText("CHỮ KÝ SỐ HỢP LỆ THEO CHUẨN FOXIT READER & CƠ QUAN THUẾ")).toBeVisible();
    await expect(verifyModal.getByText("4401053694").first()).toBeVisible();
    await expect(verifyModal.getByText("WINCA / WINGROUP CA").first()).toBeVisible();

    // Close modal
    await verifyModal.getByRole("button", { name: "✕" }).click();
    await expect(verifyModal).toBeHidden();

    // Open Audit Modal on desktop and verify NO raw JSON is shown
    const auditBtn = desktopTable.getByRole("button", { name: /Kiểm định/i });
    await auditBtn.click();
    const auditModal = page.locator(".piecework-modal-box");
    await expect(auditModal).toBeVisible();
    await expect(auditModal.getByText("Báo Cáo Kiểm Định Hồ Sơ Chi Tiết")).toBeVisible();
    await expect(auditModal.getByText("CCCD Trước")).toBeVisible();
    await expect(auditModal.getByText("CCCD Sau (Chip)")).toBeVisible();
    // Strictly verify NO raw JSON strings exist in the UI
    await expect(auditModal).not.toContainText('{"valid":');
    await expect(auditModal).not.toContainText('{"cccd_format":');
    await expect(auditModal).not.toContainText('{"acceptance_doc":');
    await auditModal.getByRole("button", { name: "✕" }).click();
    await expect(auditModal).toBeHidden();

    // Open Share Modal on desktop
    const shareBtn = desktopTable.getByRole("button", { name: /Share/i });
    await shareBtn.click();
    const shareModal = page.locator(".piecework-modal-box");
    await expect(shareModal).toBeVisible();
    await expect(shareModal.getByText("Chia Sẻ Hợp Đồng & Tệp PDF")).toBeVisible();
    await expect(shareModal.getByRole("button", { name: /PDF ĐÃ KÝ SỐ/i })).toBeVisible();
    await expect(shareModal.getByRole("button", { name: /PDF BẢN THẢO/i })).toBeVisible();
    await expect(shareModal.getByRole("button", { name: /LINK KÝ ONLINE/i })).toBeVisible();

    // Switch to Draft / Unsigned tab and verify ?signed=0
    await shareModal.getByRole("button", { name: /PDF BẢN THẢO/i }).click();
    const urlInput = shareModal.locator("input[type='text']");
    await expect(urlInput).toHaveValue(/signed=0/);

    // Switch back to Signed tab and verify ?signed=1
    await shareModal.getByRole("button", { name: /PDF ĐÃ KÝ SỐ/i }).click();
    await expect(urlInput).toHaveValue(/signed=1/);
    await shareModal.getByRole("button", { name: "✕" }).click();
    await expect(shareModal).toBeHidden();

    // Switch to Tab 2: Contractor Directory
    await tabContractors.click();
    const contractorsTable = page.locator("[data-testid='contractors-desktop-table']");
    await expect(contractorsTable).toBeVisible();
    await expect(contractorsTable.getByText("Lê Văn Hải")).toBeVisible();
    await expect(contractorsTable.getByText("CTV-HAI-4512")).toBeVisible();
    await expect(contractorsTable.getByText("038092004512")).toBeVisible();

    // Open Tax Summary modal for contractor
    const taxBtn = contractorsTable.getByRole("button", { name: /Quyết Toán Thuế/i });
    await taxBtn.click();
    const taxModal = page.locator(".piecework-modal-box");
    await expect(taxModal).toBeVisible();
    await expect(taxModal.getByText("Bảng Kê Chi Trả Thù Lao & Khấu Trừ Thuế TNCN")).toBeVisible();
    await expect(taxModal.getByText("4.500.000 đ").first()).toBeVisible();
    await taxModal.getByRole("button", { name: "✕" }).click();
    await expect(taxModal).toBeHidden();

    // Open Smart Paste modal from header
    const smartBtn = page.getByRole("button", { name: "⚡ Smart Paste", exact: true });
    await smartBtn.click();
    const smartModal = page.locator(".piecework-modal-box");
    await expect(smartModal).toBeVisible();
    await expect(smartModal.getByText("Dán Nhanh & Trích Xuất Thông Tin Thợ")).toBeVisible();
    await smartModal.getByRole("button", { name: "✕" }).click();
    await expect(smartModal).toBeHidden();
  }

  if (testInfo.project.name === "mobile") {
    // Mobile: Desktop table must be hidden, Mobile Card Stack must be visible!
    await expect(page.locator(".piecework-desktop-table")).toBeHidden();
    const mobileCards = page.locator(".piecework-mobile-cards");
    await expect(mobileCards).toBeVisible();

    // Card should be rendered
    const card = page.locator(".piecework-mobile-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByText("01/2026/HĐGK-DONGSON")).toBeVisible();
    await expect(card.getByText("Lê Văn Hải")).toBeVisible();
    await expect(card.getByText("4.500.000 đ")).toBeVisible();

    // Touch targets must be at least 40px high for finger ergonomics
    const touchBtn = card.getByRole("button", { name: /Copy Zalo thợ/i });
    await expect(touchBtn).toBeVisible();
    const box = await touchBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40);

    // Open detail modal on mobile
    const detailBtn = card.getByRole("button", { name: /Chi tiết HĐ/i });
    await detailBtn.click();

    const detailModal = page.locator(".piecework-modal-box");
    await expect(detailModal).toBeVisible();
    await expect(detailModal.getByText("Chi tiết Hồ sơ & Deficiency Checklist")).toBeVisible();

    // Verify eKYC selfie photo & signature section is present
    await expect(detailModal.getByText("Bằng Chứng Xác Thực Ký Điện Tử & Chân Dung eKYC của Thợ")).toBeVisible();
    await expect(detailModal.getByAltText("Ảnh chân dung eKYC")).toBeVisible();

    // Check no horizontal overflow inside modal
    const modalOverflow = await detailModal.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(modalOverflow).toBeLessThanOrEqual(1);

    // Close detail modal
    await detailModal.getByRole("button", { name: "✕" }).click();
    await expect(detailModal).toBeHidden();

    // Open Signing Modal on mobile
    const signBtn = card.getByRole("button", { name: /Ký lại INUT|Ký số INUT/i });
    await signBtn.click();

    const signModal = page.locator(".piecework-modal-box");
    await expect(signModal).toBeVisible();
    await expect(signModal.getByText("Ký Số Điện Tử Bên A (INUT)")).toBeVisible();

    // Verify default contract date radio is present and checked
    const defaultRadio = signModal.getByLabel(/Theo ngày trên hợp đồng khoán/i);
    await expect(defaultRadio).toBeChecked();
    const dtInput = signModal.locator("input[type='datetime-local']");
    await expect(dtInput).toHaveAttribute("step", "1");
    // Verify input fits inside the modal without sticking out
    const dtBox = await dtInput.boundingBox();
    const signBox = await signModal.boundingBox();
    expect(dtBox).not.toBeNull();
    expect(signBox).not.toBeNull();
    expect(dtBox!.x + dtBox!.width).toBeLessThanOrEqual(signBox!.x + signBox!.width + 4);

    // Close signing modal
    await signModal.getByRole("button", { name: "✕" }).click();
    await expect(signModal).toBeHidden();

    // Open Audit Modal on mobile and verify NO raw JSON is shown
    const mobileAuditBtn = card.getByRole("button", { name: /Kiểm định/i });
    await mobileAuditBtn.click();
    const mobileAuditModal = page.locator(".piecework-modal-box");
    await expect(mobileAuditModal).toBeVisible();
    await expect(mobileAuditModal.getByText("Báo Cáo Kiểm Định Hồ Sơ Chi Tiết")).toBeVisible();
    await expect(mobileAuditModal.getByText("CCCD Trước")).toBeVisible();
    await expect(mobileAuditModal.getByText("CCCD Sau (Chip)")).toBeVisible();
    // Strictly verify NO raw JSON strings exist in the UI on mobile
    await expect(mobileAuditModal).not.toContainText('{"valid":');
    await expect(mobileAuditModal).not.toContainText('{"cccd_format":');
    await expect(mobileAuditModal).not.toContainText('{"acceptance_doc":');
    await mobileAuditModal.getByRole("button", { name: "✕" }).click();
    await expect(mobileAuditModal).toBeHidden();

    // Open Share Modal on mobile
    const mobileShareBtn = card.getByRole("button", { name: /Chia sẻ PDF/i });
    await mobileShareBtn.click();
    const mobileShareModal = page.locator(".piecework-modal-box");
    await expect(mobileShareModal).toBeVisible();
    await expect(mobileShareModal.getByText("Chia Sẻ Hợp Đồng & Tệp PDF")).toBeVisible();
    await expect(mobileShareModal.getByRole("button", { name: /Gửi qua Zalo/i })).toBeVisible();
    await expect(mobileShareModal.getByRole("button", { name: /Gửi qua Email/i })).toBeVisible();

    // Switch to draft unsigned tab on mobile
    await mobileShareModal.getByRole("button", { name: /PDF BẢN THẢO/i }).click();
    const mobileUrlInput = mobileShareModal.locator("input[type='text']");
    await expect(mobileUrlInput).toHaveValue(/signed=0/);
    await mobileShareModal.getByRole("button", { name: "✕" }).click();
    await expect(mobileShareModal).toBeHidden();

    // Switch to Contractor tab on mobile
    await tabContractors.click();
    const mobileContractorCards = page.locator("[data-testid='contractors-mobile-cards']");
    await expect(mobileContractorCards).toBeVisible();
    const cCard = mobileContractorCards.locator(".piecework-mobile-card").first();
    await expect(cCard.getByText("Lê Văn Hải")).toBeVisible();
    await expect(cCard.getByText("038092004512")).toBeVisible();

    // Check tax summary on mobile
    const mobileTaxBtn = cCard.getByRole("button", { name: /Quyết Toán Thuế/i });
    await mobileTaxBtn.click();
    const mTaxModal = page.locator(".piecework-modal-box");
    await expect(mTaxModal).toBeVisible();
    await expect(mTaxModal.getByText("Bảng Kê Chi Trả Thù Lao & Khấu Trừ Thuế TNCN")).toBeVisible();
    await mTaxModal.getByRole("button", { name: "✕" }).click();
    await expect(mTaxModal).toBeHidden();
  }
});
