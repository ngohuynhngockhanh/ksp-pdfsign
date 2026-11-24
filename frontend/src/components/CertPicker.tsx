import { useState } from "react";
import { api, type CertInfo } from "../api";
import { parseDn } from "../util";
import {
  AppButton,
  EmptyState,
  InlineAlert,
  SkeletonBlock,
  StatusBadge,
} from "./ui";

interface Props {
  ip: string;
  adminPassword: string;
  value: string;
  onChange: (certId: string) => void;
}

export function CertPicker({ ip, adminPassword, value, onChange }: Props) {
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.listCerts(ip, adminPassword);
      setCerts(r.certs);
      setHasLoaded(true);
      // Tự chọn chứng thư còn hạn đầu tiên
      const valid = r.certs.find((c) => new Date(c.valid_to) > new Date());
      if (valid && !value) onChange(valid.id);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-stack--sm">
      <AppButton
        variant="secondary"
        size="sm"
        fullWidth
        leftIcon="key"
        loading={busy}
        onClick={load}
      >
        {busy ? "Đang tải chứng thư…" : "Lấy danh sách chứng thư"}
      </AppButton>

      {err && (
        <InlineAlert tone="danger" onDismiss={() => setErr("")}>
          {err}
        </InlineAlert>
      )}

      {busy && certs.length === 0 && (
        <div className="cert-skeleton" role="status" aria-busy="true" aria-label="Đang tải danh sách chứng thư">
          <SkeletonBlock variant="line" lines={3} />
        </div>
      )}

      {hasLoaded && !busy && !err && certs.length === 0 && (
        <EmptyState
          compact
          icon="key"
          title="Không tìm thấy chứng thư"
          description="Kiểm tra kết nối USB Token trên máy WIN-CA rồi tải lại."
        />
      )}

      {certs.length > 0 && (
        <div className="ui-stack--sm" role="radiogroup" aria-label="Danh sách chứng thư số">
          {certs.map((c) => {
            const { cn, mst } = parseDn(c.subject);
            const ca = parseDn(c.issuer).cn;
            const expired = new Date(c.valid_to) <= new Date();
            const isSelected = value === c.id;
            return (
              <label key={c.id} className={`ui-choice-card${isSelected ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="cert"
                  checked={isSelected}
                  onChange={() => onChange(c.id)}
                />
                <div className="ui-flex-1">
                  <div className="ui-row-between ui-text-semibold">
                    <span className="ui-wrap">{cn}</span>
                    {expired ? (
                      <StatusBadge tone="danger" size="sm" icon="alert-circle">
                        Hết hạn
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="success" size="sm" icon="check-circle">
                        Còn hạn
                      </StatusBadge>
                    )}
                  </div>
                  <div className="cert-meta">
                    {mst && (
                      <span className="num">
                        <b>MST:</b> {mst}
                      </span>
                    )}
                    <span>
                      <b>CA:</b> {ca}
                    </span>
                  </div>
                  <div className="cert-meta num">
                    <span>
                      <b>Hiệu lực:</b> {c.valid_from.slice(0, 10)} – {c.valid_to.slice(0, 10)}
                    </span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
