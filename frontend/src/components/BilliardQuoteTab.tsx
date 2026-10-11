import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export function BilliardQuoteTab({
  onGenerated,
}: {
  onGenerated?: (docId: string, filename: string, docType: string, customerId: number | null, orderId: number | null) => void;
}) {
  const [numTables, setNumTables] = useState<number>(10);
  const [includeCamera, setIncludeCamera] = useState<boolean>(true);
  const [includeSoftware, setIncludeSoftware] = useState<boolean>(true);
  const [clientName, setClientName] = useState<string>("Billiards 10 bàn");
  const [contactPerson, setContactPerson] = useState<string>("Chủ CLB Billiards");
  const [phone, setPhone] = useState<string>("09xx.xxx.xxx");
  const [address, setAddress] = useState<string>("TP. Hồ Chí Minh / Toàn quốc");
  const [dateDisplay, setDateDisplay] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  });

  const [estimateData, setEstimateData] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [previewBusy, setPreviewBusy] = useState<boolean>(false);
  const [previewErr, setPreviewErr] = useState<string>("");
  const [generating, setGenerating] = useState<boolean>(false);
  const [genResult, setGenResult] = useState<any>(null);

  // Fetch estimate calculation whenever inputs change
  useEffect(() => {
    api
      .billiardEstimate({
        tables: numTables,
        include_camera: includeCamera,
        include_software: includeSoftware,
        client_name: clientName,
      })
      .then((res) => {
        if (res.ok) {
          setEstimateData(res.data);
        }
      })
      .catch((err) => console.error("Error fetching billiard estimate:", err));
  }, [numTables, includeCamera, includeSoftware, clientName]);

  // Debounced PDF preview
  const previewPayload = JSON.stringify({
    num_tables: numTables,
    client_name: clientName,
    contact_person: contactPerson,
    phone,
    address,
    include_camera: includeCamera,
    include_software: includeSoftware,
    date_display: dateDisplay,
  });

  useEffect(() => {
    const t = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const payload = JSON.parse(previewPayload);
        const blob = await api.billiardQuotePreview(payload);
        setPreviewErr("");
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      } catch (err) {
        setPreviewErr((err as Error).message);
      } finally {
        setPreviewBusy(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [previewPayload]);

  const previewUrlRef = useRef("");
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  async function handleGenerateQuote() {
    setGenerating(true);
    try {
      const payload = {
        num_tables: numTables,
        client_name: clientName,
        contact_person: contactPerson,
        phone,
        address,
        include_camera: includeCamera,
        include_software: includeSoftware,
        date_display: dateDisplay,
        filename: `Bao_gia_Billiards_${numTables}_ban_${includeCamera && includeSoftware ? "Full_Combo" : (includeSoftware ? "Chi_Phan_Mem_17790k" : "Chi_Camera")}.pdf`,
      };
      const res = await api.billiardQuoteGenerate(payload);
      if (res.ok) {
        setGenResult(res);
        if (onGenerated) {
          onGenerated(res.doc_id, res.filename, "bao_gia", null, null);
        }
      }
    } catch (err) {
      alert("Lỗi tạo báo giá: " + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* Preset Banner */}
      <div style={{ background: "linear-gradient(135deg, #0f172a, #1e3a8a)", borderRadius: 12, padding: "14px 18px", color: "#fff", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(56,189,248,0.2)", color: "#38bdf8", padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
              🎱 iNut BilliardLive
            </div>
            <h4 style={{ margin: "6px 0 2px 0", fontSize: 17, color: "#f8fafc" }}>
              Báo Giá Giải Pháp Billiards (Bóc Tách Khối Lượng Từng Gói)
            </h4>
            <div style={{ fontSize: 12.5, color: "#cbd5e1" }}>
              Tự động phân bổ Hub PoE (8 cam/hub 8P, phần dư &le;4 cam dùng hub 4P rẻ hơn 25%) · Tách riêng Gói Camera &amp; Gói Phần mềm Billiard Live · Chưa VAT (VAT 8%) · <b>Không cần ký số</b>.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                setNumTables(10);
                setIncludeSoftware(true);
                setClientName("Billiards 10 bàn");
              }}
              style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: includeSoftware && numTables === 10 ? "#38bdf8" : "rgba(255,255,255,0.15)", color: includeSoftware && numTables === 10 ? "#0f172a" : "#fff", border: "none", cursor: "pointer" }}
            >
              10 Cam + Phần mềm
            </button>
            <button
              type="button"
              onClick={() => {
                setNumTables(10);
                setIncludeSoftware(false);
                setClientName("Billiards 10 bàn (Không PM)");
              }}
              style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: !includeSoftware && numTables === 10 ? "#38bdf8" : "rgba(255,255,255,0.15)", color: !includeSoftware && numTables === 10 ? "#0f172a" : "#fff", border: "none", cursor: "pointer" }}
            >
              10 Cam (0 phần mềm)
            </button>
          </div>
        </div>
      </div>

      <div className="quote-2col">
        {/* Left Form */}
        <div className="q-form">
          <div className="panel" style={{ padding: 16 }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 14, color: "#0f172a" }}>⚙️ Thông Số Quy Mô Quán &amp; Tùy Chọn Gói</h4>

            {/* Quick table size & software toggle */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Số bàn Bida (Số lượng camera) *
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={numTables}
                    onChange={(e) => {
                      const v = Math.max(1, parseInt(e.target.value) || 1);
                      setNumTables(v);
                      if (clientName.includes("bàn")) {
                        setClientName(`Billiards ${v} bàn${!includeSoftware ? " (Không PM)" : ""}`);
                      }
                    }}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "2px solid #0284c7", fontSize: 15, fontWeight: 700, color: "#0f172a" }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>bàn</span>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Ngày lập báo giá
                </label>
                <input
                  type="text"
                  value={dateDisplay}
                  onChange={(e) => setDateDisplay(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>
            </div>

            {/* Software Toggle Checkbox */}
            {/* Package Toggles */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div style={{ background: includeCamera ? "#eff6ff" : "#f8fafc", border: `1.5px solid ${includeCamera ? "#3b82f6" : "#cbd5e1"}`, borderRadius: 10, padding: "10px 12px" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={includeCamera}
                    onChange={(e) => setIncludeCamera(e.target.checked)}
                    style={{ width: 17, height: 17, marginTop: 2, cursor: "pointer" }}
                  />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: includeCamera ? "#1d4ed8" : "#475569" }}>
                      📷 Gói I: Lắp đặt Camera &amp; Hạ tầng
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      {numTables} camera KBVision 5MP, POE Splitter, Hub PoE (8P/4P tối ưu), cáp LAN, vật tư và nhân công.
                    </div>
                  </div>
                </label>
              </div>

              <div style={{ background: includeSoftware ? "#f0fdf4" : "#f8fafc", border: `1.5px solid ${includeSoftware ? "#10b981" : "#cbd5e1"}`, borderRadius: 10, padding: "10px 12px" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={includeSoftware}
                    onChange={(e) => setIncludeSoftware(e.target.checked)}
                    style={{ width: 17, height: 17, marginTop: 2, cursor: "pointer" }}
                  />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: includeSoftware ? "#15803d" : "#475569" }}>
                      💻 Gói II: Phần mềm Billiard Live
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      Thiết bị Stream Model C1 ({numTables === 10 ? "17.790.000đ" : "chuẩn theo kênh"}), QR cắt cam, Check VAR màn hình lớn, livestream, tỷ số.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Customer Info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 3 }}>
                  Tên Khách hàng / Quán Bida
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ví dụ: CLB Billiards Victory"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5 }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 3 }}>
                  Người liên hệ / SĐT
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    placeholder="Chủ quán"
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5 }}
                  />
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="09xx..."
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12.5 }}
                  />
                </div>
              </div>
            </div>

            {/* Cost Breakdown Summary Cards */}
            {estimateData && (
              <div style={{ background: "#f1f5f9", padding: 12, borderRadius: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                  <span>📊 Bóc tách khối lượng dự toán:</span>
                  <span style={{ color: "#b91c1c", fontSize: 11.5 }}>* Chưa bao gồm VAT 8%</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: includeSoftware ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8 }}>
                  <div style={{ background: "#fff", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Gói I (Camera &amp; Hạ tầng):</div>
                    <div style={{ fontSize: 14.5, fontWeight: 800, color: "#0284c7", marginTop: 2 }}>
                      {estimateData.total_group_1?.toLocaleString("vi-VN")} ₫
                    </div>
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                      {numTables} cam + {numTables <= 8 ? "1 Hub 8P" : "1 Hub 8P + 1 Hub 4P (-25%)"}
                    </div>
                  </div>

                  {includeSoftware && (
                    <div style={{ background: "#fff", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1" }}>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Gói II (Billiard Live):</div>
                      <div style={{ fontSize: 14.5, fontWeight: 800, color: "#0f766e", marginTop: 2 }}>
                        {estimateData.total_group_2?.toLocaleString("vi-VN")} ₫
                      </div>
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                        Model C1 + Giảm MKT
                      </div>
                    </div>
                  )}

                  <div style={{ background: "#ecfdf5", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #86efac" }}>
                    <div style={{ fontSize: 11, color: "#166534", fontWeight: 700 }}>TỔNG DỰ ÁN:</div>
                    <div style={{ fontSize: 15.5, fontWeight: 900, color: "#15803d", marginTop: 2 }}>
                      {estimateData.grand_total?.toLocaleString("vi-VN")} ₫
                    </div>
                    <div style={{ fontSize: 10, color: "#166534" }}>
                      {includeSoftware ? "Trọn gói Full Combo" : "Chỉ phần cứng camera"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Hub PoE Logic Badge */}
            <div style={{ fontSize: 11.5, background: "#f0f9ff", borderLeft: "3px solid #0284c7", padding: "6px 10px", borderRadius: "0 6px 6px 0", color: "#0369a1", marginBottom: 14 }}>
              💡 <b>Logic Hub PoE mở rộng:</b> Mỗi Hub 8 port cấp tối đa 8 cam (1.100.000đ). Với {numTables} camera, hệ thống tự động ghép {Math.floor(numTables / 8)} Hub 8 port + {numTables % 8 > 0 && numTables % 8 <= 4 ? "1 Hub 4 port (825.000đ - rẻ hơn 25%)" : (numTables % 8 > 4 ? "1 Hub 8 port" : "0 Hub")} giúp tối ưu chi phí hạ tầng.
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                type="button"
                className="primary"
                onClick={handleGenerateQuote}
                disabled={generating}
                style={{ flex: 1, padding: "12px 18px", fontSize: 14, fontWeight: 800, background: "#0284c7", border: "none", borderRadius: 8, cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <span>🚀</span>
                <span>{generating ? "Đang xuất PDF..." : "Xuất PDF Gửi Khách (Không ký số)"}</span>
              </button>
            </div>

            {/* Generate Success Notification */}
            {genResult && (
              <div style={{ marginTop: 14, padding: 12, background: "#ecfdf5", border: "1.5px solid #86efac", borderRadius: 8 }}>
                <div style={{ fontWeight: 800, color: "#166534", fontSize: 13 }}>✓ ĐÃ TẠO BÁO GIÁ THÀNH CÔNG!</div>
                <div style={{ fontSize: 12, color: "#334155", margin: "4px 0" }}>Tệp: <b>{genResult.filename}</b></div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <a
                    href={genResult.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ padding: "6px 12px", background: "#0284c7", color: "#fff", borderRadius: 6, fontSize: 12, fontWeight: 700, textDecoration: "none" }}
                  >
                    📄 Mở xem trực tiếp
                  </a>
                  <a
                    href={genResult.download_url}
                    style={{ padding: "6px 12px", background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontWeight: 700, textDecoration: "none" }}
                  >
                    ⬇️ Tải xuống PDF
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      const shareText = `Kính gửi Quý khách Báo giá giải pháp Camera & Phần mềm Billiard Live cho ${numTables} bàn: ${window.location.origin}${genResult.pdf_url}`;
                      navigator.clipboard.writeText(shareText);
                      alert("Đã sao chép link báo giá gửi Zalo cho khách hàng!");
                    }}
                    style={{ padding: "6px 12px", background: "#0f766e", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    📲 Copy link gửi Zalo
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Preview */}
        <div className="q-preview" style={{ minHeight: 650 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
              XEM TRƯỚC BÁO GIÁ BILLIARDS (WYSIWYG 1 TRANG A4)
            </span>
            {previewBusy && <small style={{ color: "#0284c7", fontWeight: 700 }}>Đang cập nhật...</small>}
          </div>
          {previewErr ? (
            <div className="err" style={{ padding: 12, background: "#fee2e2", color: "#b91c1c", borderRadius: 8, fontSize: 12 }}>
              Lỗi xem trước: {previewErr}
            </div>
          ) : previewUrl ? (
            <iframe src={previewUrl} title="Xem trước báo giá Billiards" style={{ width: "100%", height: 720, border: "1px solid #cbd5e1", borderRadius: 8 }} />
          ) : (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>Đang tải bản xem trước...</div>
          )}
        </div>
      </div>
    </div>
  );
}
