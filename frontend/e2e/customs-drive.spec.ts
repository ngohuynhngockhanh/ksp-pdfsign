import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("quản trị bộ hồ sơ Drive và hàng chờ tờ khai", async ({ page }) => {
  let folders: any[] = [];
  const declaration = { id: 12, so_to_khai: "108286660050", ngay_dang_ky: "2026-05-20", ma_loai_hinh: "A12", phan_luong: "3", co_quan_hq: "", nguoi_xk: "", nuoc_xk: "CN", so_van_don: "", so_hoa_don: "", ngay_hoa_don: "", phuong_thuc_tt: "", incoterm: "", nguyen_te: "USD", tri_gia_nt: 100, phi_ship_nt: 0, ti_gia: 26000, tri_gia_tinh_thue: 2600000, tong_thue_nk: 0, tong_thue_vat: 260000, status: "draft", note: "", created_at: "", doc_url: "", tong_costs: 0, lines: [], costs: [] };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: { username: "admin", role: "admin", customer_id: null, customer_name: null, agent_default_ip: "", default_location: "", using_default_secrets: false, must_change_password: false, training_access: false } });
    if (path === "/api/inv/warehouses") return route.fulfill({ json: [{ id: 1, code: "HH", name: "Hàng hóa" }] });
    if (path === "/api/inv/customs" && route.request().method() === "GET") return route.fulfill({ json: [declaration] });
    if (path === "/api/inv/customs-drive/sources") return route.fulfill({ json: [{ id: 1, year: 2026, folder_id: "1yg_TqCrWS4dDx-O-bYYhfktFq1OdNk9z", enabled: true, last_synced_at: "" }] });
    if (path === "/api/inv/customs-drive/folders" && route.request().method() === "GET") return route.fulfill({ json: folders });
    if (path === "/api/inv/customs-drive/sync/2026") {
      folders = [{ id: 1, year: 2026, drive_folder_id: "folder-a", name: "108286660050", path: "108286660050", drive_url: "https://drive.google.com/drive/folders/folder-a", customs_id: 12, link_status: "linked", dossier_status: "needs_review", match_reason: "Khớp số tờ khai", checklist: { declaration: { state: "ok" }, ci: { state: "ok" }, pl: { state: "ok" }, origin: { state: "review" } }, findings: [{ level: "vang", code: "origin_statement_only", message: "Đã thấy Origin China trên CI/PL; cần review mục đích ưu đãi C/O." }], synced_at: "", documents: [{ id: 1, name: "Commercial Invoice Origin China.pdf", path: "108286660050/Commercial Invoice Origin China.pdf", kind: "ci", mime_type: "application/pdf", size: 100, parse_error: "", file_url: "/api/inv/customs-drive/documents/1/file" }] }, { id: 2, year: 2026, drive_folder_id: "folder-b", name: "Chưa có tờ khai", path: "Chưa có tờ khai", drive_url: "https://drive.google.com/drive/folders/folder-b", customs_id: null, link_status: "waiting_declaration", dossier_status: "missing_documents", match_reason: "Chưa tìm thấy tờ khai", checklist: { declaration: { state: "missing" }, ci: { state: "ok" }, pl: { state: "missing" }, origin: { state: "missing" } }, findings: [{ level: "do", code: "missing_pl", message: "Thiếu Packing List (PL)." }], synced_at: "", documents: [] }];
      return route.fulfill({ json: { job_id: 1, status: "success", stats: { folders: 2, linked: 1, waiting: 1, imported: 0 } } });
    }
    if (path === "/api/inv/customs-drive/folders/2/assign") return route.fulfill({ json: { ...folders[1], customs_id: 12, link_status: "linked", match_reason: "Được gán thủ công" } });
    if (path.endsWith("/review")) return route.fulfill({ json: folders[0] });
    return route.fulfill({ json: {} });
  });

  await page.goto("/to-khai-nk");
  await expect(page.getByRole("heading", { name: "Bộ hồ sơ theo tờ khai" })).toBeVisible();
  await page.getByRole("button", { name: "Đồng bộ Drive" }).click();
  await expect(page.getByText("Đã đồng bộ 2 folder")).toBeVisible();
  await expect(page.getByRole("button", { name: "Chờ tờ khai" })).toBeVisible();
  await expect(page.getByText("Commercial Invoice Origin China.pdf")).toBeVisible();
  await expect(page.getByText("Đã thấy Origin China trên CI/PL; cần review mục đích ưu đãi C/O.")).toBeVisible();
  await page.getByLabel("Gán tờ khai cho Chưa có tờ khai").selectOption("12");
  await expect(page.getByText("Đã gán folder vào tờ khai.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const accessibility = await new AxeBuilder({ page }).include(".customs-drive-dossiers").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
