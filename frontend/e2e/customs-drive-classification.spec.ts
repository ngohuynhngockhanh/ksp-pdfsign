import { expect, test } from "@playwright/test";

const documents = [
  { id: 11, name: "Invoice-2026.pdf", path: "108286660050/Invoice-2026.pdf", kind: "ci", mime_type: "application/pdf", size: 125000, parse_error: "", file_url: "/api/inv/customs-drive/documents/11/file" },
  { id: 12, name: "scan-khong-ro.pdf", path: "108286660050/scan-khong-ro.pdf", kind: "other", mime_type: "application/pdf", size: 83000, parse_error: "OCR không đọc được nội dung", file_url: "/api/inv/customs-drive/documents/12/file" },
];

const folder = {
  id: 3, year: 2026, drive_folder_id: "folder-a", name: "108286660050",
  path: "108286660050", drive_url: "https://drive.google.com/drive/folders/folder-a",
  customs_id: 9, link_status: "linked", dossier_status: "missing_documents",
  match_reason: "Khớp số tờ khai 12 chữ số trong folder hoặc chứng từ.",
  checklist: { declaration: { state: "ok" }, ci: { state: "ok" }, pl: { state: "missing" }, origin: { state: "missing" } },
  findings: [{ level: "do", code: "missing_pl", message: "Thiếu Packing List (PL)." }],
  synced_at: "2026-07-31T08:00:00Z", documents,
};

test("admin sees a complete document table and can classify each file", async ({ page }) => {
  let changedKind = "";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: {
      username: "admin", role: "admin", customer_name: null, agent_default_ip: "",
      default_location: "", using_default_secrets: false, must_change_password: false,
    }});
    if (path === "/api/inv/customs-drive/sources") return route.fulfill({ json: [{ id: 1, year: 2026, folder_id: "drive-root-2026", enabled: true, last_synced_at: "" }] });
    if (path === "/api/inv/customs-drive/folders" && request.method() === "GET") return route.fulfill({ json: [folder] });
    if (path === "/api/inv/customs-drive/documents/12/kind" && request.method() === "PATCH") {
      changedKind = request.postDataJSON().kind;
      await new Promise((resolve) => setTimeout(resolve, 350));
      return route.fulfill({ json: { ...folder, documents: documents.map((doc) => doc.id === 12 ? { ...doc, kind: changedKind } : doc) } });
    }
    if (path === "/api/inv/customs") return route.fulfill({ json: [] });
    if (path === "/api/inv/warehouses") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  await page.goto("/to-khai-nk");

  const dossier = page.getByRole("region", { name: "Bộ hồ sơ 108286660050" });
  await expect(dossier.getByRole("columnheader", { name: "Chứng từ", exact: true })).toBeVisible();
  await expect(dossier.getByRole("columnheader", { name: "Loại chứng từ" })).toBeVisible();
  await expect(dossier.getByRole("columnheader", { name: "Liên quan / dùng để làm gì" })).toBeVisible();
  await expect(dossier).toContainText("Đã có");
  await expect(dossier).toContainText("Còn thiếu");
  await expect(dossier).toContainText("Đối chiếu trị giá, người bán, điều kiện giao hàng và thanh toán.");
  await expect(dossier).toContainText("OCR không đọc được nội dung");
  await expect(dossier.locator(".customs-kind-control.kind-ci")).toHaveCount(1);
  await expect(dossier.locator(".customs-kind-control.kind-other")).toHaveCount(1);

  await dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf").selectOption("pl");
  await expect(dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf")).toHaveValue("pl", { timeout: 100 });
  await expect(dossier.getByRole("row", { name: /scan-khong-ro\.pdf/ })).toContainText("Đang tự lưu");
  expect(changedKind).toBe("pl");
  await expect(dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf")).toHaveValue("pl");
  await expect(dossier.locator(".customs-kind-control.kind-pl")).toHaveCount(1);
  await expect(dossier.getByRole("row", { name: /scan-khong-ro\.pdf/ })).toContainText("Đã lưu tự động");
  await expect(page.getByText("Đã lưu tự động loại chứng từ và tính lại checklist hồ sơ.")).toBeVisible();

  await dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf").selectOption("datasheet");
  expect(changedKind).toBe("datasheet");
  await expect(dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf")).toHaveValue("datasheet");
  await expect(dossier.locator(".customs-kind-control.kind-datasheet")).toHaveCount(1);
  await expect(dossier).toContainText("thông số kỹ thuật, model, điện áp");

  await dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf").selectOption("arrival_notice");
  await expect(dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf")).toHaveValue("arrival_notice", { timeout: 100 });
  await expect(dossier.locator(".customs-kind-control.kind-arrival_notice")).toHaveCount(1);
  await expect(dossier).toContainText("ngày tàu đến, cảng dỡ hàng");

  await dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf").selectOption("product_photo");
  await expect(dossier.getByLabel("Loại chứng từ của scan-khong-ro.pdf")).toHaveValue("product_photo", { timeout: 100 });
  await expect(dossier.locator(".customs-kind-control.kind-product_photo")).toHaveCount(1);
  await expect(dossier).toContainText("hình dáng, nhãn, model và tình trạng thực tế");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
