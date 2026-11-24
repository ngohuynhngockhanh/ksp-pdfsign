import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  AppButton,
  AppIcon,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  SectionCard,
  SplitWorkspace,
  StatusBadge,
  useToast,
} from "./ui";

export function BilliardQuoteTab({
  onGenerated,
}: {
  onGenerated?: (docId: string, filename: string, docType: string, customerId: number | null, orderId: number | null) => void;
}) {
  const toast = useToast();
  const [numTables, setNumTables] = useState<number>(10);
  const [includeCamera, setIncludeCamera] = useState<boolean>(true);
  const [includeSoftware, setIncludeSoftware] = useState<boolean>(true);
  const [clientName, setClientName] = useState<string>("Billiards 10 bàn");
  const [contactPerson, setContactPerson] = useState<string>("Chủ CLB Billiards");
  const [phone, setPhone] = useState<string>("09xx.xxx.xxx");
  const [address, setAddress] = useState<string>("TP. Hồ Chí Minh / Toàn quốc");
  const [agency, setAgency] = useState<string>("16pool");
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

  useEffect(() => {
    api
      .billiardEstimate({
        tables: numTables,
        agency,
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
  }, [numTables, agency, includeCamera, includeSoftware, clientName]);

  const previewPayload = JSON.stringify({
    num_tables: numTables,
    client_name: clientName,
    contact_person: contactPerson,
    phone,
    address,
    agency,
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
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  async function handleGenerateQuote() {
    setGenerating(true);
    try {
      const payload = {
        num_tables: numTables,
        client_name: clientName,
        contact_person: contactPerson,
        phone,
        address,
        agency,
        include_camera: includeCamera,
        include_software: includeSoftware,
        date_display: dateDisplay,
        filename: `Bao_gia_Billiards_${numTables}_ban_${agency}_${includeCamera && includeSoftware ? "Full_Combo" : includeSoftware ? "Chi_Phan_Mem_17790k" : "Chi_Camera"}.pdf`,
      };
      const res = await api.billiardQuoteGenerate(payload);
      if (res.ok) {
        setGenResult(res);
        toast.success("Đã tạo báo giá Billiards thành công.");
        if (onGenerated) {
          onGenerated(res.doc_id, res.filename, "bao_gia", null, null);
        }
      }
    } catch (err) {
      toast.error("Lỗi tạo báo giá: " + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function copyZaloLink() {
    if (!genResult) return;
    const shareText = `Kính gửi Quý khách Báo giá giải pháp Camera & Phần mềm Billiard Live cho ${numTables} bàn: ${window.location.origin}${genResult.pdf_url}`;
    try {
      await navigator.clipboard.writeText(shareText);
      toast.success("Đã sao chép link báo giá gửi Zalo cho khách hàng!");
    } catch {
      toast.error("Không thể sao chép tự động — hãy copy thủ công.");
    }
  }

  const isPresetCombo = agency === "16pool" && includeCamera && includeSoftware && numTables === 10;
  const isPresetSwOnly = agency === "16pool" && !includeCamera && includeSoftware && numTables === 10;
  const isPresetCamOnly = includeCamera && !includeSoftware && numTables === 10;

  return (
    <div className="ui-stack--lg">
      <SectionCard
        tone="subtle"
        padding="compact"
        title="Báo Giá Giải Pháp Billiards (Bóc Tách Khối Lượng Từng Gói)"
        subtitle="Tự động phân bổ Hub PoE (8 cam/hub 8P, dư <= 4 cam dùng hub 4P -25%) · Tách Gói Camera & Billiard Live · Chưa VAT 8% · Không cần ký số."
        icon="camera"
      >
        <div className="ui-row">
          <AppButton
            variant={isPresetCombo ? "primary" : "secondary"}
            size="sm"
            leftIcon="zap"
            onClick={() => {
              setNumTables(10);
              setAgency("16pool");
              setIncludeCamera(true);
              setIncludeSoftware(true);
              setClientName("Billiards 10 bàn (16Pool Full Combo)");
            }}
          >
            10 Cam + PM (16Pool)
          </AppButton>
          <AppButton
            variant={isPresetSwOnly ? "primary" : "secondary"}
            size="sm"
            leftIcon="cpu"
            onClick={() => {
              setNumTables(10);
              setAgency("16pool");
              setIncludeCamera(false);
              setIncludeSoftware(true);
              setClientName("Billiards 10 bàn (Chỉ PM 17.790k - 16Pool)");
            }}
          >
            10 Bàn Chỉ PM 17.790k (16Pool)
          </AppButton>
          <AppButton
            variant={isPresetCamOnly ? "primary" : "secondary"}
            size="sm"
            leftIcon="camera"
            onClick={() => {
              setNumTables(10);
              setIncludeCamera(true);
              setIncludeSoftware(false);
              setClientName("Billiards 10 bàn (Chỉ Camera)");
            }}
          >
            10 Bàn Chỉ Camera (0 PM)
          </AppButton>
        </div>
      </SectionCard>

      <SplitWorkspace
        variant="preview-right"
        stickySecondary
        mobileTabs={["Cấu hình báo giá", "Xem trước A4"]}
        primary={
          <div className="ui-stack--lg">
            <SectionCard title="Thông số quy mô quán & tùy chọn gói" icon="sliders">
              <div className="ui-stack--lg">
                <FormGrid cols={2}>
                  <FormField label="Số bàn Bida (Số lượng camera)" htmlFor="billiard-tables" required>
                    <input
                      id="billiard-tables"
                      className="ui-input"
                      type="number"
                      min={1}
                      max={100}
                      value={numTables}
                      onChange={(e) => {
                        const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                        setNumTables(v);
                        if (clientName.includes("bàn")) {
                          setClientName(`Billiards ${v} bàn${!includeSoftware ? " (Không PM)" : ""}`);
                        }
                      }}
                    />
                  </FormField>

                  <FormField label="Ngày lập báo giá" htmlFor="billiard-date">
                    <input
                      id="billiard-date"
                      className="ui-input"
                      type="text"
                      value={dateDisplay}
                      onChange={(e) => setDateDisplay(e.target.value)}
                    />
                  </FormField>
                </FormGrid>

                <FormGrid cols={2}>
                  <label className={`ui-choice-card${includeCamera ? " is-active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={includeCamera}
                      onChange={(e) => setIncludeCamera(e.target.checked)}
                    />
                    <div>
                      <div className="studio-toggle-title">
                        <AppIcon name="camera" size={15} />
                        <span>Gói I: Lắp đặt Camera &amp; Hạ tầng</span>
                      </div>
                      <div className="studio-toggle-desc">
                        {numTables} camera KBVision 5MP, POE Splitter, Hub PoE (8P/4P tối ưu), cáp LAN, vật tư và nhân công.
                      </div>
                    </div>
                  </label>

                  <label className={`ui-choice-card${includeSoftware ? " is-active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={includeSoftware}
                      onChange={(e) => setIncludeSoftware(e.target.checked)}
                    />
                    <div>
                      <div className="studio-toggle-title">
                        <AppIcon name="cpu" size={15} />
                        <span>Gói II: Phần mềm Billiard Live</span>
                      </div>
                      <div className="studio-toggle-desc">
                        Thiết bị Stream Model C1 ({numTables === 10 ? "17.790.000đ" : "chuẩn theo kênh"}), QR cắt cam, Check VAR màn hình lớn, livestream, tỷ số.
                      </div>
                    </div>
                  </label>
                </FormGrid>

                <FormField label="Đơn vị xuất báo giá / Đại lý phân phối" htmlFor="billiard-agency">
                  <select
                    id="billiard-agency"
                    className="ui-select"
                    value={agency}
                    onChange={(e) => setAgency(e.target.value)}
                  >
                    <option value="16pool">Đại lý phân phối 16POOL STUDIO (16pool.vn - Hải Phòng)</option>
                    <option value="inut">Trực tiếp CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT (Mặc định)</option>
                  </select>
                </FormField>

                <FormGrid cols={2}>
                  <FormField label="Tên Khách hàng / Quán Bida" htmlFor="billiard-client">
                    <input
                      id="billiard-client"
                      className="ui-input"
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Ví dụ: CLB Billiards Victory"
                    />
                  </FormField>
                  <FormField label="Địa chỉ" htmlFor="billiard-address">
                    <input
                      id="billiard-address"
                      className="ui-input"
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="TP. Hồ Chí Minh / Toàn quốc"
                    />
                  </FormField>
                  <FormField label="Người liên hệ" htmlFor="billiard-contact">
                    <input
                      id="billiard-contact"
                      className="ui-input"
                      type="text"
                      value={contactPerson}
                      onChange={(e) => setContactPerson(e.target.value)}
                      placeholder="Chủ quán"
                    />
                  </FormField>
                  <FormField label="Số điện thoại" htmlFor="billiard-phone">
                    <input
                      id="billiard-phone"
                      className="ui-input"
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="09xx..."
                    />
                  </FormField>
                </FormGrid>

                {estimateData && (
                  <KpiStrip
                    columns={includeSoftware ? 3 : 2}
                    items={[
                      {
                        label: "Gói I (Camera & Hạ tầng)",
                        value: `${estimateData.total_group_1?.toLocaleString("vi-VN")} ₫`,
                        sub: `${numTables} cam + ${numTables <= 8 ? "1 Hub 8P" : "1 Hub 8P + 1 Hub 4P (-25%)"}`,
                        tone: "brand",
                        icon: "camera",
                      },
                      ...(includeSoftware
                        ? [
                            {
                              label: "Gói II (Billiard Live)",
                              value: `${estimateData.total_group_2?.toLocaleString("vi-VN")} ₫`,
                              sub: "Model C1 + Giảm MKT",
                              tone: "info" as const,
                              icon: "cpu" as const,
                            },
                          ]
                        : []),
                      {
                        label: "Tổng dự án (chưa VAT 8%)",
                        value: `${estimateData.grand_total?.toLocaleString("vi-VN")} ₫`,
                        sub: includeSoftware ? "Trọn gói Full Combo" : "Chỉ phần cứng camera",
                        tone: "success",
                        icon: "coins",
                      },
                    ]}
                  />
                )}

                <InlineAlert tone="info" title="Logic Hub PoE mở rộng">
                  Mỗi Hub 8 port cấp tối đa 8 cam (1.100.000đ). Với {numTables} camera, hệ thống tự động ghép{" "}
                  {Math.floor(numTables / 8)} Hub 8 port +{" "}
                  {numTables % 8 > 0 && numTables % 8 <= 4
                    ? "1 Hub 4 port (825.000đ - rẻ hơn 25%)"
                    : numTables % 8 > 4
                      ? "1 Hub 8 port"
                      : "0 Hub"}{" "}
                  giúp tối ưu chi phí hạ tầng.
                </InlineAlert>

                <AppButton
                  variant="primary"
                  size="lg"
                  fullWidth
                  leftIcon="file-down"
                  loading={generating}
                  onClick={handleGenerateQuote}
                >
                  {generating ? "Đang xuất PDF…" : "Xuất PDF Gửi Khách (Không ký số)"}
                </AppButton>

                {genResult && (
                  <InlineAlert tone="success" title="Đã tạo báo giá thành công">
                    <div className="ui-stack--sm">
                      <div>
                        Tệp: <strong>{genResult.filename}</strong>
                      </div>
                      <div className="ui-row">
                        <a
                          href={genResult.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ui-btn ui-btn--primary ui-btn--sm"
                        >
                          <AppIcon name="eye" size={14} />
                          <span>Mở xem trực tiếp</span>
                        </a>
                        <a
                          href={genResult.download_url}
                          className="ui-btn ui-btn--secondary ui-btn--sm"
                        >
                          <AppIcon name="download" size={14} />
                          <span>Tải xuống PDF</span>
                        </a>
                        <AppButton variant="secondary" size="sm" leftIcon="copy" onClick={copyZaloLink}>
                          Copy link gửi Zalo
                        </AppButton>
                      </div>
                    </div>
                  </InlineAlert>
                )}
              </div>
            </SectionCard>
          </div>
        }
        secondary={
          <SectionCard
            title="Xem trước báo giá Billiards (WYSIWYG 1 trang A4)"
            icon="eye"
            padding="compact"
            actions={
              <StatusBadge tone={previewBusy ? "info" : "neutral"} size="sm">
                {previewBusy ? "Đang cập nhật…" : "1 trang A4"}
              </StatusBadge>
            }
          >
            <div className="ui-stack--sm">
              {previewErr ? (
                <InlineAlert tone="danger">Lỗi xem trước: {previewErr}</InlineAlert>
              ) : previewUrl ? (
                <iframe
                  className="ui-iframe-tall"
                  src={previewUrl}
                  title="Xem trước báo giá Billiards"
                />
              ) : (
                <EmptyState
                  compact
                  icon="file-search"
                  title="Đang tải bản xem trước…"
                  description="Bản PDF Billiards sẽ hiển thị ngay sau khi tính dự toán."
                />
              )}
            </div>
          </SectionCard>
        }
      />
    </div>
  );
}
