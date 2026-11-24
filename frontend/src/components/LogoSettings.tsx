import { useState, type ChangeEvent } from "react";
import { api } from "../api";
import { AppButton, AppIcon, useToast } from "../components/ui";

export function LogoSettings() {
  const toast = useToast();
  const [url, setUrl] = useState(api.logoUrl());
  const [imgBroken, setImgBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setMsg("");
    try {
      await api.uploadLogo(f);
      setImgBroken(false);
      setUrl(api.logoUrl());
      const okText = "Đã cập nhật logo.";
      setMsg(okText);
      toast.success(okText);
    } catch (ex) {
      const errText = (ex as Error).message;
      setMsg(errText);
      toast.error(errText);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setMsg("");
    try {
      await api.resetLogo();
      setImgBroken(false);
      setUrl(api.logoUrl());
      const okText = "Đã khôi phục logo mặc định (INUT).";
      setMsg(okText);
      toast.success(okText);
    } catch (ex) {
      const errText = (ex as Error).message;
      setMsg(errText);
      toast.error(errText);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="logo-settings ui-stack--sm">
      {imgBroken ? (
        <div className="ui-logo-frame ui-logo-frame--lg ui-logo-fallback" aria-label="Logo mặc định INUT">
          <AppIcon name="image" size={22} />
          <span>INUT Logo</span>
        </div>
      ) : (
        <img
          src={url}
          alt="Logo chữ ký"
          className="logo-preview"
          onError={() => setImgBroken(true)}
        />
      )}

      <div className="logo-actions">
        <label className="ui-btn ui-btn--secondary ui-btn--sm">
          <AppIcon name="upload" size={14} />
          <span>Đổi logo</span>
          <input type="file" accept="image/*" onChange={onFile} hidden disabled={busy} />
        </label>
        <AppButton
          variant="ghost"
          size="sm"
          leftIcon="rotate-ccw"
          disabled={busy}
          onClick={reset}
        >
          Mặc định
        </AppButton>
      </div>

      {msg && <p className="ui-muted">{msg}</p>}
      <p className="ui-muted">Logo chìm mờ trên chữ ký. Mặc định là logo INUT.</p>
    </div>
  );
}
