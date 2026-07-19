import { api } from "./api";

// Tên đăng nhập mặc định = tên công ty: bỏ dấu tiếng Việt, thường hoá,
// khoảng trắng và ký tự đặc biệt -> "_".
export function slugUsername(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Mật khẩu mặc định = "inut12345", hoặc "{MST}inut12345" nếu có MST.
export function defaultPassword(mst?: string): string {
  const m = (mst || "").trim();
  return (m ? m : "") + "inut12345";
}

// Trích Common Name (tên) và MST từ chuỗi subject/issuer của chứng thư.
export function parseDn(dn: string): { cn: string; mst: string } {
  const cn = /CN=([^,]+)/.exec(dn)?.[1]?.trim() ?? dn;
  const mst = /MST:?\s*([0-9\-]+)/.exec(dn)?.[1] ?? "";
  return { cn, mst };
}

// Copy text vào clipboard (có fallback nếu trình duyệt chặn).
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

// Tạo link chia sẻ 1 hồ sơ, tạo text (kèm tài khoản nếu chọn) và copy clipboard.
export async function shareDocument(docPk: number): Promise<string | null> {
  const includeAccount = window.confirm(
    "Kèm tài khoản đăng nhập mặc định cho khách?\n(OK = có kèm tài khoản/mật khẩu, Cancel = chỉ link tải)",
  );
  const s = await api.createShare(docPk, 7, includeAccount);
  const exp = new Date(s.expires_at).toLocaleString("vi-VN");
  let text = `Tài liệu: ${s.filename}\nLink tải (hết hạn ${exp}):\n${s.url}`;
  if (s.account) {
    const origin = new URL(s.url).origin;
    text +=
      `\n\nHoặc đăng nhập để xem tất cả hồ sơ tại ${origin}` +
      `\nTài khoản: ${s.account.username}\nMật khẩu: ${s.account.password}`;
  }
  await copyText(text);
  return text;
}

// Tạo nhanh khách hàng mới (kèm tài khoản mặc định). Trả về id hoặc null.
export async function quickCreateCustomer(
  suggestName = "",
): Promise<{ id: number; username: string; password: string; name: string } | null> {
  const name = window.prompt("Tên công ty / khách hàng mới:", suggestName);
  if (!name || !name.trim()) return null;
  const mst = window.prompt("Mã số thuế (tuỳ chọn, để trống nếu không có):", "") || "";
  const username = slugUsername(name);
  const password = defaultPassword(mst);
  try {
    const c = await api.createCustomer({
      name: name.trim(),
      tax_code: mst.trim(),
      account_username: username,
      account_password: password,
    });
    window.alert(
      `Đã tạo khách hàng "${name.trim()}".\n\nTài khoản đăng nhập: ${username}\nMật khẩu: ${password}\n\n(Ghi lại để gửi cho khách hàng.)`,
    );
    return { id: c.id, username, password, name: name.trim() };
  } catch (e) {
    window.alert((e as Error).message);
    return null;
  }
}
