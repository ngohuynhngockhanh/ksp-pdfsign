import {
  api,
  type BiddingDossierReviewDetail,
  type BiddingDossierReviewItem,
} from "../../api";
import {
  AppButton,
  AppIcon,
  DataView,
  FormGrid,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  ResponsiveTabs,
  SectionCard,
  StatusBadge,
} from "../../components/ui";
import { openExternalSafe, safeHttpUrl } from "../../utils/url";
import { formatVnd, type DossierSubTab } from "./biddingUtils";

export interface DossierReviewTabProps {
  dossierReviews: BiddingDossierReviewItem[];
  activeDossierReview: BiddingDossierReviewDetail;
  dossierSubTab: DossierSubTab;
  setDossierSubTab: (tab: DossierSubTab) => void;
  onSelectDossierReview: (id: number) => void;
  onOpenImportDrive: () => void;
  onCopyDiscountLetter: () => void;
}

const DISCOUNT_LETTER_PREVIEW = `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc

THƯ GIẢM GIÁ DỰ THẦU
Kính gửi: Công ty TNHH MTV Quản lý, khai thác công trình thủy lợi Sơn La

Căn cứ E-HSMT gói thầu IB2600557773;
Nhà thầu Công ty Cổ phần Kỹ thuật Tự động hóa IOT xin đề xuất mức giảm giá tự nguyện như sau:
- Tỷ lệ giảm giá: 6,0% (Sáu phần trăm) trên tổng giá dự thầu ghi tại Mẫu số 12.1A.
- Giá trị giảm giá: 71.694.000 VNĐ (Bảy mươi mốt triệu sáu trăm chín mươi tư nghìn đồng).
- GIÁ DỰ THẦU SAU GIẢM GIÁ: 1.123.206.000 VNĐ (Một tỷ một trăm hai mươi ba triệu hai trăm linh sáu nghìn đồng chẵn).

(Mức giá này đảm bảo Cty IOT chiến thắng tuyệt đối trước mọi đối thủ cạnh tranh mà vẫn duy trì biên lợi nhuận ròng >55%).`;

export function DossierReviewTab({
  dossierReviews,
  activeDossierReview,
  dossierSubTab,
  setDossierSubTab,
  onSelectDossierReview,
  onOpenImportDrive,
  onCopyDiscountLetter,
}: DossierReviewTabProps) {
  const exportMdHref = safeHttpUrl(
    api.bidding.getDossierExportMarkdownUrl(activeDossierReview.id),
  );
  const passCount = activeDossierReview.files.filter(
    (f) => f.compliance_status === "pass",
  ).length;
  const hasFail = activeDossierReview.files.some(
    (f) => f.compliance_status === "fail",
  );

  return (
    <div className="ui-stack--lg">
      {/* Executive Dossier Overview Banner */}
      <section className="ui-banner">
        <div className="ui-row-between ui-row--start">
          <div className="ui-grow ui-stack">
            <span className="ui-banner-eyebrow">
              <AppIcon name="shield-check" size={14} />
              THẨM ĐỊNH HỒ SƠ DỰ THẦU CHUYÊN SÂU · MULTI-AGENT REVIEW
            </span>
            <h2 className="ui-banner-title">{activeDossierReview.package_name}</h2>
            <p className="ui-banner-sub">
              Mã TBMT: <strong className="ui-banner-gold">{activeDossierReview.tbmt_code}</strong>{" "}
              · Bên mời thầu: <strong>{activeDossierReview.procuring_entity}</strong>
            </p>
            <p className="ui-banner-sub">
              Nhà thầu lập hồ sơ: <strong>{activeDossierReview.contractor_name}</strong> (MST:{" "}
              {activeDossierReview.contractor_tax_code}) · Đối tác công nghệ lõi:{" "}
              <strong className="ui-banner-gold">INUT Technology</strong>
            </p>
          </div>

          {dossierReviews.length > 1 && (
            <select
              className="ui-select"
              aria-label="Chọn bộ hồ sơ thẩm định"
              value={activeDossierReview.id}
              onChange={(e) => onSelectDossierReview(Number(e.target.value))}
            >
              {dossierReviews.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.tbmt_code} - {r.package_name.slice(0, 40)}... ({r.overall_score}/100)
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="ui-banner-actions">
          {exportMdHref && (
            <a
              href={exportMdHref}
              download={`Bao_cao_tham_dinh_${activeDossierReview.tbmt_code}.md`}
              className="ui-btn ui-btn--primary ui-btn--sm"
            >
              <AppIcon name="download" size={14} />
              <span>Tải Báo Cáo Markdown</span>
            </a>
          )}

          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="printer"
            onClick={() => window.print()}
          >
            In Báo Cáo
          </AppButton>

          <AppButton
            variant="gold"
            size="sm"
            leftIcon="message-square"
            onClick={() => {
              const text = `Kính gửi anh Thắng Cty IoT, INUT Technology gửi kết quả thẩm định hồ sơ thầu Sơn La (${activeDossierReview.tbmt_code}): Điểm tuân thủ 96/100. Lưu ý sửa ngay 12 ô placeholder ở File 06 và nhận Giấy cam kết kỹ thuật của INUT để thắng thầu. Xem chi tiết: ${window.location.origin}/bidding/dossier-reviews`;
              const zaloUrl = `https://zalo.me/share?url=${encodeURIComponent(window.location.href)}&message=${encodeURIComponent(text)}`;
              openExternalSafe(zaloUrl);
            }}
          >
            Gửi Zalo Cho Anh Thắng Cty IoT
          </AppButton>

          <AppButton
            variant="danger"
            size="sm"
            leftIcon="mail"
            onClick={() => {
              const subject =
                "Kết quả Thẩm định Hồ sơ thầu Sơn La IB2600557773 - INUT & Cty IOT";
              const body = `Kính gửi anh Thắng,\n\nHội đồng kỹ thuật INUT Technology đã thẩm định toàn diện 9 tài liệu dự thầu gói thầu Sơn La (IB2600557773):\n- Điểm tuân thủ tổng thể: 96/100 điểm.\n- Giá dự thầu: 1.194.900.000 đ.\n\nĐặc biệt lưu ý 3 điểm cần sửa gấp trước khi nộp thầu:\n1. Điền cự ly và tuyến đường cụ thể vào File 06 (hiện đang để [CẦN XÁC NHẬN]).\n2. Kẹp Giấy cam kết hỗ trợ kỹ thuật và bảo hành 5 năm của INUT Technology.\n3. Sửa lỗi chính tả cơ quan cấp ĐKKD trong File 01.\n\nChi tiết báo cáo tại: ${window.location.href}`;
              window.location.href = `mailto:${activeDossierReview.contractor_tax_code ? "kythuattudonghoaiot@gmail.com" : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            }}
          >
            Gửi Email
          </AppButton>

          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="plus"
            className="bid-ml-auto"
            onClick={onOpenImportDrive}
          >
            Nhập Hồ Sơ Thầu Mới (Google Drive)
          </AppButton>
        </div>
      </section>

      {/* Unified KPI Strip */}
      <KpiStrip
        columns={4}
        items={[
          {
            label: "Điểm số tuân thủ tổng thể",
            value: `${activeDossierReview.overall_score} / 100`,
            sub: "Tiềm năng trúng thầu số 1",
            icon: "shield-check",
            tone: "success",
          },
          {
            label: "Giá dự thầu (Mẫu 12.1A)",
            value: formatVnd(activeDossierReview.total_bid_price),
            sub: `Dự toán: ${formatVnd(activeDossierReview.estimated_package_price)} (Giảm 0.39%)`,
            icon: "banknote",
            tone: "brand",
          },
          {
            label: "Đánh giá 9 tài liệu",
            value: `${passCount} Đạt · 1 Cảnh báo · 1 Lỗi`,
            sub: "File 06 có 12 ô placeholder cần sửa",
            icon: "file-warning",
            tone: hasFail ? "danger" : "success",
          },
          {
            label: "Lợi nhuận gộp dự kiến",
            value: "~759.900.000 ₫ (63.6%)",
            sub: "Nhờ tự chủ công nghệ iNut & SCADA",
            icon: "trending-up",
            tone: "gold",
          },
        ]}
      />

      {/* Dossier Sub-Tabs Bar */}
      <ResponsiveTabs
        ariaLabel="Chuyển mục thẩm định hồ sơ thầu"
        active={dossierSubTab}
        onChange={setDossierSubTab}
        tabs={[
          {
            id: "executive",
            label: "Tóm Tắt Chiến Lược & 3 Điểm Nóng",
            icon: "clipboard-list",
          },
          {
            id: "files",
            label: "Thẩm Định 9 Tài Liệu",
            icon: "folder",
            badge: activeDossierReview.files.length,
          },
          {
            id: "items",
            label: "Ma Trận Kỹ Thuật 18 Hạng Mục",
            icon: "wrench",
            badge: activeDossierReview.items.length,
          },
          {
            id: "pricing",
            label: "Cơ Cấu Giá & Thư Giảm Giá",
            icon: "coins",
          },
        ]}
      />

      {/* SUBTAB 1: EXECUTIVE BRIEFING */}
      {dossierSubTab === "executive" && (
        <div className="ui-stack--lg">
          <InlineAlert
            tone="danger"
            title="CẢNH BÁO ĐỎ: 3 ĐIỂM CHÍ MẠNG CẦN SỬA GẤP TRƯỚC KHI NỘP THẦU"
          >
            Nếu không sửa ngay, Tổ chuyên gia chấm thầu có căn cứ đánh LOẠI BỎ (FAIL) hồ sơ dự thầu!
          </InlineAlert>

          <div className="ui-stack">
            <article className="ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--danger">
              <div className="ui-inline ui-text-xs ui-text-strong">
                <AppIcon name="shield-alert" size={16} />
                <span>
                  1. Lỗi Placeholder chưa điền trong File 06 (Biện pháp vận chuyển) — NGUY HIỂM NHẤT!
                </span>
              </div>
              <div className="ui-muted">
                Bảng cung đường Table 2 File 06 còn để nguyên văn các dòng mẫu{" "}
                <code>[CẦN NHÀ THẦU XÁC NHẬN TUYẾN ĐƯỜNG THỰC TẾ]</code> và{" "}
                <code>[CẦN XÁC NHẬN] km</code>. Nộp lên E-GP sẽ bị đánh Không Đạt ngay tại Tiêu chí
                2.2!
              </div>
              <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--success">
                <span>
                  <strong>Khắc phục ngay:</strong> Điền cự ly chuẩn: Bản Mòn <b>22 km</b> (xe tải
                  1.5T), Chiềng Khoi <b>64 km</b> (xe tải 2.5T), Suối Chiếu <b>128 km</b> (xe 2.5T
                  gầm cao), Suối Hòm <b>145 km</b> (xe 2.5T gầm cao).
                </span>
              </div>
            </article>

            <article className="ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--danger">
              <div className="ui-inline ui-text-xs ui-text-strong">
                <AppIcon name="shield-alert" size={16} />
                <span>
                  2. Bổ sung Giấy xác nhận hỗ trợ kỹ thuật của Hãng INUT cho Mục 4 &amp; Mục 17
                  (File 04)
                </span>
              </div>
              <div className="ui-muted">
                Bảng đối chiếu kỹ thuật ghi rõ: <i>&ldquo;CHƯA ĐỦ CĂN CỨ VỀ LAN/P2P&rdquo;</i> và{" "}
                <i>&ldquo;CẦN XÁC NHẬN GIẢI PHÁP CHỐNG SÉT&rdquo;</i>. Cần tài liệu chứng minh chính
                thức từ nhà sản xuất.
              </div>
              <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--success">
                <span>
                  <strong>Khắc phục ngay:</strong> INUT Technology (MST 4401053694) ký số và cung
                  cấp ngay Văn bản Cam kết kỹ thuật P2P/LAN và giải pháp chống sét SPD tích hợp để
                  kẹp vào hồ sơ.
                </span>
              </div>
            </article>

            <article className="ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--warning">
              <div className="ui-inline ui-text-xs ui-text-strong">
                <AppIcon name="alert-triangle" size={16} />
                <span>3. Sửa lỗi chính tả cơ quan cấp ĐKKD trong File 01 (Pháp lý)</span>
              </div>
              <div className="ui-muted">
                Kê khai nhầm thành &ldquo;Phòng ĐKKD - Sở Tài chính tỉnh Sơn La&rdquo;. Thẩm quyền
                chuẩn theo Nghị định 01/2021/NĐ-CP là Sở Kế hoạch và Đầu tư.
              </div>
              <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--success">
                <span>
                  <strong>Khắc phục ngay:</strong> Đổi lại thành{" "}
                  <b>&ldquo;Phòng Đăng ký kinh doanh - Sở Kế hoạch và Đầu tư tỉnh Sơn La&rdquo;</b>.
                </span>
              </div>
            </article>
          </div>

          <SectionCard
            title="1. Tổng Quan Đánh Giá & Điểm Mạnh Vượt Trội Của Nhà Thầu"
            icon="clipboard-check"
          >
            <div className="ui-stack">
              <div>{activeDossierReview.executive_summary}</div>

              <div className="ui-stack">
                <h3 className="bid-card-heading">Các Khuyến Nghị Chiến Lược Cốt Lõi:</h3>
                {activeDossierReview.recommendations.map((rec, idx) => (
                  <div key={idx} className="ui-subpanel ui-subpanel--md ui-stack--xs">
                    <div className="ui-row">
                      <StatusBadge tone="brand" size="sm">
                        #{idx + 1}
                      </StatusBadge>
                      <span>{rec}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* SUBTAB 2: INDEPENDENT 9 FILES AUDIT */}
      {dossierSubTab === "files" && (
        <div className="ui-stack">
          {activeDossierReview.files.map((f) => {
            const isPass = f.compliance_status === "pass";
            const isWarning = f.compliance_status === "warning";
            const isFail = f.compliance_status === "fail";
            const cardTone = isPass
              ? "ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--success"
              : isWarning
                ? "ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--warning"
                : "ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--danger";

            return (
              <article key={f.id} className={cardTone}>
                <div className="ui-row-between ui-row--start">
                  <div className="ui-grow">
                    <div className="ui-muted ui-mono">
                      TÀI LIỆU {f.file_code} · {f.file_name}
                    </div>
                    <h3 className="bid-card-heading">{f.file_title}</h3>
                  </div>

                  <div className="ui-row">
                    <StatusBadge
                      tone={isPass ? "success" : isWarning ? "warning" : "danger"}
                      variant="outline"
                      size="sm"
                    >
                      {f.score}/100 điểm
                    </StatusBadge>
                    <StatusBadge
                      tone={isPass ? "success" : isWarning ? "warning" : "danger"}
                      icon={isPass ? "check" : isWarning ? "alert-triangle" : "alert-circle"}
                      size="sm"
                    >
                      {isPass ? "ĐẠT" : isWarning ? "CẢNH BÁO" : "CẦN SỬA GẤP"}
                    </StatusBadge>
                  </div>
                </div>

                <FormGrid cols={2}>
                  <div className="ui-subpanel ui-subpanel--md ui-stack--xs">
                    <span className="ui-inline ui-text-xs ui-text-strong">
                      <AppIcon name="search" size={14} /> Phát hiện chính
                    </span>
                    <span>{f.findings}</span>
                  </div>

                  <div
                    className={
                      isFail ? "ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--danger" : "ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--warning"
                    }
                  >
                    <span className="ui-inline ui-text-xs ui-text-strong">
                      <AppIcon name={isFail ? "shield-alert" : "alert-triangle"} size={14} />
                      {isFail ? "Rủi ro loại thầu" : "Rủi ro cần lưu ý"}
                    </span>
                    <span>{f.critical_risks}</span>
                  </div>
                </FormGrid>

                <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--success">
                  <span className="ui-inline ui-text-xs ui-text-strong">
                    <AppIcon name="sparkles" size={14} /> Biện pháp khắc phục / Khuyến nghị
                  </span>
                  <span>{f.remediation}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* SUBTAB 3: TECHNICAL MATRIX (18 EQUIPMENT ITEMS) */}
      {dossierSubTab === "items" && (
        <DataView
          mobileMode="card"
          stickyHeader
          desktop={
            <SectionCard padding="flush">
              <div className="table-wrap">
                <table className="dt ui-table">
                  <thead>
                    <tr>
                      <th>STT</th>
                      <th>Tên thiết bị &amp; Thông số</th>
                      <th>Ký mã hiệu &amp; Hãng SX</th>
                      <th className="ui-text-center">SL</th>
                      <th className="ui-text-right">Đơn giá (VNĐ)</th>
                      <th className="ui-text-right">Thành tiền (VNĐ)</th>
                      <th>Vai trò INUT</th>
                      <th className="ui-text-center">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDossierReview.items.map((it) => {
                      const isOk = it.compliance_status === "compliant";
                      const isOem = it.inut_role.includes("OEM");
                      return (
                        <tr key={it.id}>
                          <td className="num">{it.item_no}</td>
                          <td>
                            <div className="ui-meta-value">{it.item_name}</div>
                            <div className="ui-muted ui-mono">Id: {it.system_id}</div>
                            {it.notes && <div className="ui-muted">{it.notes}</div>}
                          </td>
                          <td>
                            <div className="ui-meta-value">{it.proposed_model}</div>
                            <div className="ui-muted">
                              {it.manufacturer} ({it.origin})
                            </div>
                          </td>
                          <td className="ui-text-center num">
                            {it.quantity} {it.unit}
                          </td>
                          <td className="ui-text-right num">
                            {it.unit_price.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="ui-text-right num">
                            <strong>{it.total_price.toLocaleString("vi-VN")} đ</strong>
                          </td>
                          <td>
                            <StatusBadge tone={isOem ? "success" : "neutral"} size="sm">
                              {it.inut_role}
                            </StatusBadge>
                          </td>
                          <td className="ui-text-center">
                            <StatusBadge
                              tone={isOk ? "success" : "warning"}
                              icon={isOk ? "check" : "alert-triangle"}
                              size="sm"
                            >
                              {isOk ? "ĐÁP ỨNG" : "CẦN XÁC NHẬN"}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {activeDossierReview.items.map((it) => {
                const isOk = it.compliance_status === "compliant";
                const isOem = it.inut_role.includes("OEM");
                return (
                  <MobileCard key={it.id}>
                    <MobileCardHeader
                      title={it.item_name}
                      subtitle={`#${it.item_no} · Id: ${it.system_id}`}
                      badge={
                        <StatusBadge
                          tone={isOk ? "success" : "warning"}
                          icon={isOk ? "check" : "alert-triangle"}
                          size="sm"
                        >
                          {isOk ? "ĐÁP ỨNG" : "XÁC NHẬN"}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid cols={2}>
                      <MobileCardRow
                        label="Model & Hãng SX"
                        value={`${it.proposed_model} — ${it.manufacturer} (${it.origin})`}
                        fullWidth
                      />
                      <MobileCardRow label="Số lượng" value={`${it.quantity} ${it.unit}`} mono />
                      <MobileCardRow
                        label="Đơn giá"
                        value={`${it.unit_price.toLocaleString("vi-VN")} đ`}
                        mono
                      />
                      <MobileCardRow
                        label="Vai trò INUT"
                        value={
                          <StatusBadge tone={isOem ? "success" : "neutral"} size="sm">
                            {it.inut_role}
                          </StatusBadge>
                        }
                      />
                      <MobileCardRow
                        label="Thành tiền"
                        value={`${it.total_price.toLocaleString("vi-VN")} đ`}
                        mono
                      />
                    </MobileCardGrid>
                    {it.notes && <div className="ui-muted">{it.notes}</div>}
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      )}

      {/* SUBTAB 4: PRICING BREAKDOWN & DISCOUNT STRATEGY */}
      {dossierSubTab === "pricing" && (
        <div className="ui-stack--lg">
          <KpiStrip
            columns={4}
            items={[
              {
                label: "PHẦN MỀM SCADA (MỤC 18)",
                value: "302.400.000 đ",
                sub: "Chiếm 25.31% · Lãi gộp ~90%",
                icon: "cpu",
                tone: "brand",
              },
              {
                label: "THIẾT BỊ INUT (MỤC 4 & 17)",
                value: "237.600.000 đ",
                sub: "Chiếm 19.88% · Tự chủ OEM",
                icon: "layers",
                tone: "success",
              },
              {
                label: "CẢM BIẾN QUAN TRẮC (MỤC 1-3, 14)",
                value: "329.400.000 đ",
                sub: "Chiếm 27.57% · Radar, gầu lật",
                icon: "activity",
                tone: "info",
              },
              {
                label: "MÁY CHỦ DELL & CAMERA",
                value: "325.500.000 đ",
                sub: "Chiếm 27.24% · Dell + Hikvision",
                icon: "hard-drive",
                tone: "neutral",
              },
            ]}
          />

          <SectionCard
            eyebrow="CHIẾN LƯỢC TRÚNG THẦU TUYỆT ĐỐI"
            title="Mẫu Thư Giảm Giá Chiến Lược (Đề Xuất Giảm 6% ~ 71.694.000 VNĐ)"
            icon="file-signature"
            actions={
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="copy"
                onClick={onCopyDiscountLetter}
              >
                Sao Chép Mẫu Thư Giảm Giá
              </AppButton>
            }
          >
            <div className="ui-pre">{DISCOUNT_LETTER_PREVIEW}</div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
