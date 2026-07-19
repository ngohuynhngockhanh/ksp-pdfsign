import { useState } from "react";
import { api } from "../api";

export function LogoSettings() {
  const [url, setUrl] = useState(api.logoUrl());
  const [msg, setMsg] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setMsg("");
    try {
      await api.uploadLogo(f);
      setUrl(api.logoUrl());
      setMsg("Đã cập nhật logo.");
    } catch (ex) {
      setMsg((ex as Error).message);
    }
  }

  async function reset() {
    await api.resetLogo();
    setUrl(api.logoUrl());
    setMsg("Đã khôi phục logo mặc định (INUT).");
  }

  return (
    <div className="logo-settings">
      <img src={url} alt="logo" className="logo-preview" />
      <div className="logo-actions">
        <label className="file-btn">
          Đổi logo
          <input type="file" accept="image/*" onChange={onFile} hidden />
        </label>
        <button type="button" onClick={reset}>
          Mặc định
        </button>
      </div>
      {msg && <div className="muted">{msg}</div>}
      <div className="muted">Logo chìm mờ trên chữ ký. Mặc định là logo INUT.</div>
    </div>
  );
}
