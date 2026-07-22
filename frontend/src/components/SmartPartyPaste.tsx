import { useState } from "react";

export interface SmartPartyData {
  name?: string;
  address?: string;
  mst?: string;
  email?: string;
  dai_dien?: string;
  chuc_vu?: string;
  nguoi_nhan?: string;
  dien_thoai?: string;
}

function valueAfterLabel(text: string, labels: string[]): string {
  for (const label of labels) {
    const hit = text.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:\\-]\\s*([^\\n]+)`, "i"));
    if (hit?.[1]) return hit[1].trim();
  }
  return "";
}

export function parsePartyText(raw: string): SmartPartyData {
  const text = raw.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const mst = text.match(/(?:MST|mã số thuế|tax code)\s*[:\-]?\s*(\d{10}(?:\d{3})?)/i)?.[1]
    || text.match(/\b\d{10}(?:\d{3})?\b/)?.[0] || "";
  const email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || "";
  const phone = text.match(/(?:\+?84|0)(?:[ .-]?\d){8,10}/)?.[0]?.replace(/[ .-]/g, "") || "";
  const labelledName = valueAfterLabel(text, ["tên (?:đơn vị|công ty|doanh nghiệp)", "đơn vị", "công ty", "company"]);
  const likelyName = lines.find((line) => /(?:CÔNG TY|CTY|COMPANY|TRUNG TÂM|BAN QUẢN LÝ|HỘ KINH DOANH)/i.test(line));
  return {
    name: labelledName || likelyName || lines[0] || "",
    address: valueAfterLabel(text, ["địa chỉ", "address"]),
    mst,
    email,
    dai_dien: valueAfterLabel(text, ["đại diện", "người đại diện", "representative"]),
    chuc_vu: valueAfterLabel(text, ["chức vụ", "position"]),
    nguoi_nhan: valueAfterLabel(text, ["người nhận", "người liên hệ", "liên hệ", "contact"]),
    dien_thoai: valueAfterLabel(text, ["điện thoại", "số điện thoại", "phone", "mobile"]) || phone,
  };
}

export function SmartPartyPaste({ onApply }: { onApply: (data: SmartPartyData) => void }) {
  const [raw, setRaw] = useState("");
  const [notice, setNotice] = useState("");

  function apply(text = raw) {
    if (!text.trim()) return;
    const parsed = parsePartyText(text);
    onApply(parsed);
    const count = Object.values(parsed).filter(Boolean).length;
    setNotice(`Đã nhận ${count} trường — kiểm tra lại trước khi sinh biểu mẫu.`);
  }

  return (
    <div className="smart-paste">
      <div className="smart-paste-head"><div><span>SMART PASTE</span><b>Dán một lần, tự điền Bên B</b></div><small>Hỗ trợ nội dung từ email, Zalo, chữ ký và hóa đơn</small></div>
      <textarea
        rows={4}
        value={raw}
        placeholder={"CÔNG TY...\nMST: ...\nĐịa chỉ: ...\nĐại diện: ... · Chức vụ: ...\nĐiện thoại / Email: ..."}
        onChange={(e) => setRaw(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          window.setTimeout(() => apply(text), 0);
        }}
      />
      <div className="smart-paste-foot"><span>{notice || "Dữ liệu cũ chỉ bị thay khi ô mới đọc được giá trị."}</span><button type="button" onClick={() => apply()}>Tự điền thông tin</button></div>
    </div>
  );
}
