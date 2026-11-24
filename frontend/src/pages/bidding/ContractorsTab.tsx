import {
  api,
  type BiddingContractorItem,
  type BiddingCrmScanResult,
} from "../../api";
import {
  AppButton,
  AppIcon,
  EmptyState,
  FilterBar,
  KpiStrip,
  ResponsiveTabs,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import {
  WinRateProgressBar,
  formatVnd,
  type ContractorSubTab,
  type DetailModalTab,
  type WonPackagesState,
} from "./biddingUtils";

export interface ContractorsTabProps {
  contractorSubTab: ContractorSubTab;
  onChangeSubTab: (sub: ContractorSubTab) => void;
  wonPackagesResult: WonPackagesState | null;
  wonPackagesLoading: boolean;
  wonPackagesQuery: string;
  setWonPackagesQuery: (val: string) => void;
  wonPackagesFieldFilter: string;
  setWonPackagesFieldFilter: (val: string) => void;
  onFetchWonPackages: (query?: string, field?: string) => void;
  crmScanResult: BiddingCrmScanResult | null;
  crmScanLoading: boolean;
  contractorSearchQuery: string;
  setContractorSearchQuery: (val: string) => void;
  contractorCategoryFilter: "all" | "won" | "registered" | "oem";
  setContractorCategoryFilter: (val: "all" | "won" | "registered" | "oem") => void;
  onScanCrmContractors: () => void;
  onSearchContractorsDirect: (query: string) => void;
  onOpenTenderDetail: (tbmtCode: string, initialTab?: DetailModalTab) => void;
  onOpenContractorDetail: (contractor: BiddingContractorItem) => void;
}

export function ContractorsTab({
  contractorSubTab,
  onChangeSubTab,
  wonPackagesResult,
  wonPackagesLoading,
  wonPackagesQuery,
  setWonPackagesQuery,
  wonPackagesFieldFilter,
  setWonPackagesFieldFilter,
  onFetchWonPackages,
  crmScanResult,
  crmScanLoading,
  contractorSearchQuery,
  setContractorSearchQuery,
  contractorCategoryFilter,
  setContractorCategoryFilter,
  onScanCrmContractors,
  onSearchContractorsDirect,
  onOpenTenderDetail,
  onOpenContractorDetail,
}: ContractorsTabProps) {
  const registeredCount = Array.isArray(crmScanResult?.items)
    ? crmScanResult.items.filter(
        (i) =>
          i.bidding_status === "REGISTERED_BIDDER" ||
          i.bidding_status === "OEM_SUBCONTRACTOR",
      ).length
    : 0;

  const filteredContractors = (
    Array.isArray(crmScanResult?.items) ? crmScanResult.items : []
  ).filter((item) => {
    if (contractorCategoryFilter === "won") return item.total_won > 0;
    if (contractorCategoryFilter === "registered") {
      return (
        item.bidding_status === "REGISTERED_BIDDER" ||
        item.bidding_status === "OEM_SUBCONTRACTOR"
      );
    }
    return true;
  });

  return (
    <div className="ui-stack--lg">
      <SectionCard
        title="Hồ Sơ Năng Lực Nhà Thầu & Đối Soát Khách Hàng CRM"
        subtitle="Tự động rà soát toàn bộ khách hàng trong CSDL INUT, thống kê lịch sử trúng thầu, win rate và các chủ đầu tư ruột."
        icon="building-2"
        padding="compact"
        actions={
          <div className="ui-row">
            <StatusBadge tone="success" dot size="sm">
              Dữ liệu e-GP &amp; Quyết định LCNT
            </StatusBadge>
            <AppButton
              variant="primary"
              size="sm"
              leftIcon="zap"
              loading={crmScanLoading}
              onClick={onScanCrmContractors}
            >
              {crmScanLoading ? "Đang Quét..." : "Quét Lại Năng Lực CRM"}
            </AppButton>
          </div>
        }
      >
        <ResponsiveTabs
          ariaLabel="Chuyển mục nhà thầu"
          variant="segmented"
          active={contractorSubTab}
          onChange={onChangeSubTab}
          tabs={[
            {
              id: "won_packages_playbook",
              label: "Kho Gói Thầu Đã Trúng & Cẩm Nang INUT",
              icon: "book-open",
              badge: wonPackagesResult ? wonPackagesResult.total_packages : undefined,
            },
            {
              id: "crm_contractors",
              label: "Danh Sách Khách Hàng CRM",
              icon: "building-2",
              badge: crmScanResult ? crmScanResult.total_crm_customers : 14,
            },
          ]}
        />
      </SectionCard>

      {/* SUB-VIEW A: WON PACKAGES & INUT PLAYBOOK */}
      {contractorSubTab === "won_packages_playbook" && (
        <div className="ui-stack--lg">
          <section className="ui-banner">
            <div className="ui-stack">
              <span className="ui-banner-eyebrow">
                <AppIcon name="book-open" size={13} />
                CẨM NANG HÀNH ĐỘNG ĐẤU THẦU THỰC CHIẾN • DÀNH CHO INUT (MST 4401053694)
              </span>
              <h3 className="ui-banner-title">
                Công Thức Định Giá Dự Thầu &amp; 3 Bộ Kit Hồ Sơ Chuẩn Mẫu
              </h3>
              <p className="ui-banner-sub">
                Phân tích từ hơn 100 gói thầu đã trúng của các nhà thầu lớn (Gdata, Tân Thanh
                Phương, Merap): Mức giảm giá tối ưu luôn nằm ở vùng{" "}
                <strong className="ui-banner-gold">3.2% - 4.5%</strong> so với Giá dự toán gói
                thầu để tối đa hóa điểm số tài chính mà vẫn giữ biên lợi nhuận ròng ≥ 30%.
              </p>
            </div>

            <div className="ui-grid-cards-sm">
              <div className="ui-banner-glass">
                <div className="ui-row ui-banner-gold">
                  <AppIcon name="activity" size={15} />
                  <strong>Kit 1: Quan Trắc Môi Trường TT10</strong>
                </div>
                <p className="ui-banner-sub">
                  Datalogger 4G + Web SCADA truyền FTP/MQTT chuẩn Sở TN&amp;MT. (Mẫu: 1,15 Tỷ ₫)
                </p>
              </div>

              <div className="ui-banner-glass">
                <div className="ui-row ui-banner-eyebrow">
                  <AppIcon name="zap" size={15} />
                  <strong>Kit 2: Đo Xa Điện Năng AMR/AMI</strong>
                </div>
                <p className="ui-banner-sub">
                  Modem đọc xa công tơ điện tử Elster/Gelex + MDMS biểu đồ phụ tải. (Mẫu: 760 Tr ₫)
                </p>
              </div>

              <div className="ui-banner-glass">
                <div className="ui-row ui-banner-eyebrow">
                  <AppIcon name="factory" size={15} />
                  <strong>Kit 3: Tự Động Hóa SCADA FUXA</strong>
                </div>
                <p className="ui-banner-sub">
                  Tủ điều khiển PLC/Inverter + FUXA Web SCADA trạm bơm &amp; cấp nước. (Mẫu: 945 Tr ₫)
                </p>
              </div>
            </div>
          </section>

          <FilterBar
            collapsibleMobile
            search={{
              value: wonPackagesQuery,
              onChange: (val) => {
                setWonPackagesQuery(val);
                onFetchWonPackages(val, wonPackagesFieldFilter);
              },
              placeholder:
                "Tìm gói thầu đã trúng: Nhập tên gói, số TBMT, đơn vị trúng (Gdata, Tân Thanh Phương, Merap...)",
              ariaLabel: "Tìm gói thầu đã trúng",
            }}
            activeCount={wonPackagesFieldFilter ? 1 : 0}
            onReset={() => {
              setWonPackagesQuery("");
              setWonPackagesFieldFilter("");
              onFetchWonPackages("", "");
            }}
            filters={
              <select
                className="ui-select"
                aria-label="Lọc lĩnh vực gói thầu đã trúng"
                value={wonPackagesFieldFilter}
                onChange={(e) => {
                  setWonPackagesFieldFilter(e.target.value);
                  onFetchWonPackages(wonPackagesQuery, e.target.value);
                }}
              >
                <option value="">Tất cả lĩnh vực</option>
                <option value="HH">Hàng hóa (HH)</option>
                <option value="PTV">Phi tư vấn / Dịch vụ CNTT</option>
                <option value="XL">Xây lắp (XL)</option>
              </select>
            }
            actions={
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="search"
                onClick={() => onFetchWonPackages(wonPackagesQuery, wonPackagesFieldFilter)}
              >
                Lọc
              </AppButton>
            }
          />

          {wonPackagesLoading ? (
            <div className="ui-stack">
              {[1, 2].map((i) => (
                <div key={i} className="ui-subpanel ui-subpanel--card ui-stack">
                  <SkeletonBlock variant="title" />
                  <SkeletonBlock variant="line" lines={2} />
                </div>
              ))}
            </div>
          ) : !wonPackagesResult || wonPackagesResult.packages.length === 0 ? (
            <SectionCard>
              <EmptyState
                icon="book-open"
                title="Không tìm thấy gói thầu đã trúng phù hợp"
                description="Thử xóa từ khóa hoặc chuyển sang tất cả lĩnh vực để xem kho gói thầu tham chiếu."
              />
            </SectionCard>
          ) : (
            <div className="ui-stack">
              {wonPackagesResult.packages.map((pkg) => {
                const zipHref = safeHttpUrl(api.bidding.getFullDossierZipUrl(pkg.tbmt_code));
                return (
                  <article key={pkg.id || pkg.tbmt_code} className="ui-subpanel ui-subpanel--card ui-stack ui-card-accent--gold">
                    <div className="ui-row-between ui-row--start">
                      <div className="ui-grow ui-stack">
                        <div className="ui-row">
                          <StatusBadge tone="brand" size="sm">
                            <span className="ui-mono">{pkg.tbmt_code}</span>
                          </StatusBadge>
                          <StatusBadge tone="warning" icon="folder" size="sm">
                            {pkg.field_label || pkg.field}
                          </StatusBadge>
                          <StatusBadge tone="success" icon="check" size="sm">
                            ĐÃ TRÚNG THẦU
                          </StatusBadge>
                        </div>

                        <h3
                          className="bid-card-title"
                          tabIndex={0}
                          onClick={() => onOpenTenderDetail(pkg.tbmt_code, "info")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpenTenderDetail(pkg.tbmt_code, "info");
                            }
                          }}
                        >
                          {pkg.tender_name}
                        </h3>

                        <div className="ui-muted">
                          Chủ đầu tư: <strong>{pkg.procuring_entity}</strong>
                        </div>
                      </div>

                      <div className="bid-end">
                        <span className="ui-inline ui-kicker">Giá Trúng Thầu</span>
                        <div className="bid-price bid-price--won ui-mono">
                          {formatVnd(pkg.won_price)}
                        </div>
                        <div className="ui-muted">
                          Dự toán: {formatVnd(pkg.bid_price)} (Giảm {pkg.discount_percent}%)
                        </div>
                      </div>
                    </div>

                    <div className="ui-subpanel ui-subpanel--md ui-meta-grid">
                      <div className="ui-meta-item">
                        <span className="ui-inline ui-kicker">
                          <AppIcon name="award" size={12} /> Đơn vị trúng
                        </span>
                        <span className="ui-meta-value">{pkg.contractor_name}</span>
                      </div>
                      <div className="ui-meta-item">
                        <span className="ui-inline ui-kicker">
                          <AppIcon name="file-badge" size={12} /> Quyết định phê duyệt
                        </span>
                        <span className="ui-meta-value ui-mono">
                          {pkg.decision_number} ({pkg.award_date})
                        </span>
                      </div>
                    </div>

                    {pkg.winning_factors && pkg.winning_factors.length > 0 && (
                      <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--success">
                        <span className="ui-inline ui-text-xs ui-text-strong">
                          <AppIcon name="star" size={14} /> Yếu Tố Quyết Định Trúng Thầu
                        </span>
                        <ul className="ui-bullet-list">
                          {pkg.winning_factors.map((f: string, idx: number) => (
                            <li key={idx}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {pkg.inut_playbook_takeaway && (
                      <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--warning">
                        <span className="ui-inline ui-text-xs ui-text-strong">
                          <AppIcon name="sparkles" size={14} /> Bài học &amp; Cơ hội hợp tác cho INUT
                        </span>
                        <span>{pkg.inut_playbook_takeaway}</span>
                      </div>
                    )}

                    <div className="ui-row ui-divider-top">
                      <AppButton
                        variant="primary"
                        size="sm"
                        leftIcon="eye"
                        onClick={() => onOpenTenderDetail(pkg.tbmt_code, "info")}
                      >
                        Xem Chi Tiết Gói Thầu
                      </AppButton>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="paperclip"
                        onClick={() => onOpenTenderDetail(pkg.tbmt_code, "attachments")}
                      >
                        Tải Hồ Sơ Mời Thầu (5 File)
                      </AppButton>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="users"
                        onClick={() => onOpenTenderDetail(pkg.tbmt_code, "competitors")}
                      >
                        Hồ Sơ Nhà Thầu Đối Thủ (E-HSDT)
                      </AppButton>
                      {zipHref && (
                        <a
                          href={zipHref}
                          download
                          className="ui-btn ui-btn--gold ui-btn--sm"
                        >
                          <AppIcon name="package" size={14} />
                          <span>Tải Full ZIP</span>
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-VIEW B: CRM CONTRACTORS INTELLIGENCE */}
      {contractorSubTab === "crm_contractors" && (
        <div className="ui-stack--lg">
          <KpiStrip
            columns={4}
            loading={crmScanLoading && !crmScanResult}
            items={[
              {
                label: "Tổng Khách Hàng CRM",
                value: crmScanResult ? crmScanResult.total_crm_customers : "—",
                sub: "Doanh nghiệp trong CSDL",
                icon: "building-2",
                tone: "brand",
                active: contractorCategoryFilter === "all",
                onClick: () => setContractorCategoryFilter("all"),
              },
              {
                label: "Khách Hàng Trúng Thầu",
                value: crmScanResult ? crmScanResult.total_won_contractors : "—",
                sub: "Trúng thầu cấp Bộ & Tỉnh",
                icon: "award",
                tone: "danger",
                active: contractorCategoryFilter === "won",
                onClick: () => setContractorCategoryFilter("won"),
              },
              {
                label: "Tổng Giá Trị Trúng Thầu",
                value: crmScanResult ? crmScanResult.total_won_value_formatted : "—",
                sub: "Giá trị gói thầu thắng lũy kế",
                icon: "coins",
                tone: "success",
                onClick: () => setContractorCategoryFilter("won"),
              },
              {
                label: "Nhà Thầu Công Nghệ / OEM",
                value: crmScanResult ? registeredCount : "—",
                sub: "Đối tác sản xuất & lắp đặt IoT",
                icon: "cpu",
                tone: "info",
                active: contractorCategoryFilter === "registered",
                onClick: () => setContractorCategoryFilter("registered"),
              },
            ]}
          />

          <SectionCard padding="compact">
            <div className="ui-stack">
              <FilterBar
                collapsibleMobile={false}
                search={{
                  value: contractorSearchQuery,
                  onChange: setContractorSearchQuery,
                  placeholder:
                    "Tra cứu bất kỳ doanh nghiệp / đối thủ nào: Nhập Tên công ty hoặc Mã Số Thuế (VD: Gdata, 0105365128, Tân Thanh Phương...)",
                  ariaLabel: "Tra cứu doanh nghiệp hoặc mã số thuế nhà thầu",
                }}
                activeCount={contractorCategoryFilter !== "all" ? 1 : 0}
                onReset={() => {
                  setContractorSearchQuery("");
                  setContractorCategoryFilter("all");
                  onScanCrmContractors();
                }}
                actions={
                  <AppButton
                    variant="primary"
                    size="sm"
                    leftIcon="search"
                    onClick={() => onSearchContractorsDirect(contractorSearchQuery)}
                  >
                    Tìm Kiếm Nhà Thầu
                  </AppButton>
                }
              />

              <div className="ui-row">
                <span className="ui-inline ui-kicker">Gợi ý nhanh:</span>
                <AppButton
                  variant={contractorCategoryFilter === "all" ? "primary" : "secondary"}
                  size="sm"
                  leftIcon="zap"
                  onClick={() => {
                    setContractorCategoryFilter("all");
                    onScanCrmContractors();
                  }}
                >
                  Tất cả KH CRM ({crmScanResult ? crmScanResult.total_crm_customers : 14})
                </AppButton>
                <AppButton
                  variant={contractorCategoryFilter === "won" ? "primary" : "secondary"}
                  size="sm"
                  leftIcon="award"
                  onClick={() => setContractorCategoryFilter("won")}
                >
                  Top Trúng Thầu (Gdata, Tân Thanh Phương, Merap)
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="star"
                  onClick={() => onSearchContractorsDirect("4401053694")}
                >
                  iNut Technology (4401053694)
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="cpu"
                  onClick={() => onSearchContractorsDirect("5500649200")}
                >
                  Tự Động Hóa IoT Sơn La (5500649200)
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="wrench"
                  onClick={() => onSearchContractorsDirect("0314360282")}
                >
                  Bảo Toàn Tech (0314360282)
                </AppButton>
              </div>
            </div>
          </SectionCard>

          {crmScanLoading ? (
            <div className="ui-stack">
              {[1, 2, 3].map((i) => (
                <div key={i} className="ui-subpanel ui-subpanel--card ui-stack">
                  <SkeletonBlock variant="title" />
                  <SkeletonBlock variant="line" lines={2} />
                </div>
              ))}
            </div>
          ) : filteredContractors.length === 0 ? (
            <SectionCard>
              <EmptyState
                icon="building-2"
                title="Chưa có dữ liệu nhà thầu"
                description="Bấm Quét Ngay để đồng bộ hồ sơ năng lực nhà thầu từ danh sách khách hàng CRM."
                action={
                  <AppButton
                    variant="primary"
                    leftIcon="zap"
                    onClick={onScanCrmContractors}
                  >
                    Quét Ngay
                  </AppButton>
                }
              />
            </SectionCard>
          ) : (
            <div className="ui-stack">
              {filteredContractors.map((c) => (
                <article
                  key={c.tax_code + (c.customer_id || "")}
                  className={c.total_won > 0 ? "ui-subpanel ui-subpanel--card ui-stack ui-card-accent--gold" : "ui-subpanel ui-subpanel--card ui-stack"}
                >
                  <div className="ui-row-between ui-row--start">
                    <div className="ui-grow ui-stack">
                      <div className="ui-row">
                        <h3 className="bid-card-heading">{c.name}</h3>
                        <StatusBadge
                          tone={
                            c.total_won > 0
                              ? "danger"
                              : c.bidding_status === "REGISTERED_BIDDER"
                                ? "brand"
                                : "neutral"
                          }
                          size="sm"
                        >
                          {c.bidding_status_label}
                        </StatusBadge>
                      </div>

                      <div className="ui-row ui-muted">
                        <span>
                          Mã số thuế: <strong className="ui-mono">{c.tax_code}</strong>
                        </span>
                        {c.address && (
                          <span className="ui-row">
                            <AppIcon name="map-pin" size={12} /> {c.address}
                          </span>
                        )}
                        {c.email && (
                          <span className="ui-row">
                            <AppIcon name="mail" size={12} /> {c.email}
                          </span>
                        )}
                      </div>
                    </div>

                    <AppButton
                      variant={c.total_won > 0 ? "primary" : "secondary"}
                      size="sm"
                      leftIcon="eye"
                      onClick={() => onOpenContractorDetail(c)}
                    >
                      Xem Chi Tiết Hồ Sơ ({c.total_bids} Gói)
                    </AppButton>
                  </div>

                  <div className="ui-subpanel ui-subpanel--md ui-meta-grid">
                    <div className="ui-meta-item">
                      <span className="ui-inline ui-kicker">Số Gói Tham Gia</span>
                      <span className="ui-meta-value">
                        {c.total_bids} gói ({c.total_won} trúng)
                      </span>
                    </div>

                    <div className="ui-meta-item">
                      <span className="ui-inline ui-kicker">Tỷ Lệ Trúng Thầu (Win Rate)</span>
                      <WinRateProgressBar
                        won={c.total_won}
                        total={c.total_bids}
                        rate={c.win_rate_percent}
                      />
                    </div>

                    <div className="ui-meta-item">
                      <span className="ui-inline ui-kicker">Tổng Tiền Trúng Thầu</span>
                      <span className="bid-price bid-price--won ui-mono">
                        {c.total_won_value_formatted}
                      </span>
                    </div>

                    <div className="ui-meta-item">
                      <span className="ui-inline ui-kicker">Giảm Giá TB</span>
                      <span className="bid-price">
                        {c.average_discount_percent > 0
                          ? `${c.average_discount_percent}%`
                          : "—"}
                      </span>
                    </div>
                  </div>

                  {c.top_procuring_entities && c.top_procuring_entities.length > 0 && (
                    <div className="ui-row">
                      <span className="ui-inline ui-kicker">Chủ đầu tư quen thuộc:</span>
                      {c.top_procuring_entities.map((p, idx) => (
                        <StatusBadge key={idx} tone="neutral" icon="landmark" size="sm">
                          {p}
                        </StatusBadge>
                      ))}
                    </div>
                  )}

                  {c.ai_insight && (
                    <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--brand">
                      <span className="ui-inline ui-text-xs ui-text-strong">
                        <AppIcon name="sparkles" size={14} /> Gợi ý chiến lược &amp; Cơ hội hợp tác
                        INUT
                      </span>
                      <span>{c.ai_insight}</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
