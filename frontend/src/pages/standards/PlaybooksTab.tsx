import {
  AppButton,
  DataView,
  EmptyState,
  FormGrid,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  ResponsiveTabs,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  type IconName,
} from "../../components/ui";
import type { PlaybookItem } from "./types";

interface PlaybooksTabProps {
  playbooks: PlaybookItem[];
  loading: boolean;
  selectedPlaybookId: string;
  onSelectPlaybook: (id: string) => void;
  onCopyZalo: () => void;
  onApplyToCr: (playbook: PlaybookItem) => void;
}

function playbookIcon(id: string): IconName {
  if (id.includes("rockchip")) return "cpu";
  if (id.includes("display")) return "layers";
  if (id.includes("gateway")) return "radio";
  return "book-open";
}

export function PlaybooksTab({
  playbooks,
  loading,
  selectedPlaybookId,
  onSelectPlaybook,
  onCopyZalo,
  onApplyToCr,
}: PlaybooksTabProps) {
  if (loading && playbooks.length === 0) {
    return (
      <SectionCard>
        <SkeletonBlock variant="title" />
        <SkeletonBlock variant="line" lines={4} />
      </SectionCard>
    );
  }

  if (playbooks.length === 0) {
    return (
      <EmptyState
        icon="book-open"
        title="Chưa có cẩm nang thực chiến"
        description="Các case study chứng nhận hợp quy theo dòng thiết bị iNut sẽ hiển thị tại đây."
      />
    );
  }

  const currentPlaybook = playbooks.find((p) => p.id === selectedPlaybookId) || playbooks[0];

  return (
    <div className="ui-stack--lg">
      <ResponsiveTabs
        variant="segmented"
        ariaLabel="Chọn cẩm nang sản phẩm"
        active={currentPlaybook.id}
        onChange={onSelectPlaybook}
        tabs={playbooks.map((pb) => ({
          id: pb.id,
          label: pb.title.split("(")[0].trim(),
          icon: playbookIcon(pb.id),
          badge: pb.badge,
        }))}
      />

      <SectionCard
        eyebrow={currentPlaybook.badge}
        title={currentPlaybook.title}
        subtitle={currentPlaybook.subtitle}
        icon="book-open"
        actions={
          <div className="ui-row">
            <AppButton variant="secondary" size="sm" leftIcon="copy" onClick={onCopyZalo}>
              Copy mẫu Zalo cho Lab
            </AppButton>
            <AppButton
              variant="primary"
              size="sm"
              leftIcon="file-signature"
              onClick={() => onApplyToCr(currentPlaybook)}
            >
              Tạo Bản Công Bố CR
            </AppButton>
          </div>
        }
      >
        <div className="ui-stack--lg">
          <div className="ui-stack">
            <h3 className="ui-subhead">1. Mã HS Code &amp; Thuế suất nhập khẩu</h3>
            <DataView
              mobileMode="card"
              desktop={
                <div className="ui-table-scroll-wrap" tabIndex={0}>
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Mã HS Code</th>
                        <th>Mô tả hàng hóa</th>
                        <th>Thuế NK (MFN)</th>
                        <th>Thuế Form E</th>
                        <th>Thuế VAT</th>
                        <th>Đánh giá &amp; Lưu ý</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentPlaybook.hs_codes.map((h) => (
                        <tr key={h.code} className={h.recommended ? "ui-row-selected" : undefined}>
                          <td>
                            <span className="ui-mono ui-wrap ui-text-strong ui-wrap">{h.code}</span>
                          </td>
                          <td>{h.description}</td>
                          <td className="num">{h.import_tax_mfn}</td>
                          <td className="num">{h.import_tax_form_e}</td>
                          <td className="num">{h.vat_rate}</td>
                          <td>
                            {h.recommended ? (
                              <StatusBadge tone="success" icon="check" size="sm">
                                Khuyên dùng (Miễn KTCL BTTTT)
                              </StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral" size="sm">
                                Tham khảo
                              </StatusBadge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              mobileCards={
                <div className="ui-mobile-card-list">
                  {currentPlaybook.hs_codes.map((h) => (
                    <MobileCard key={h.code} active={h.recommended}>
                      <MobileCardHeader
                        title={<span className="ui-mono ui-wrap">{h.code}</span>}
                        subtitle={h.description}
                        badge={
                          h.recommended ? (
                            <StatusBadge tone="success" icon="check" size="sm">
                              Khuyên dùng
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral" size="sm">
                              Tham khảo
                            </StatusBadge>
                          )
                        }
                      />
                      <MobileCardGrid cols={2}>
                        <MobileCardRow label="Thuế MFN" value={h.import_tax_mfn} mono />
                        <MobileCardRow label="Thuế Form E" value={h.import_tax_form_e} mono />
                        <MobileCardRow label="Thuế VAT" value={h.vat_rate} mono />
                      </MobileCardGrid>
                    </MobileCard>
                  ))}
                </div>
              }
            />
          </div>

          <div className="ui-stack">
            <h3 className="ui-subhead">2. Danh mục Quy chuẩn Kỹ thuật (QCVN BTTTT) bắt buộc</h3>
            <div className="ui-grid-cards-md">
              {currentPlaybook.required_standards.map((std) => {
                const isCert = std.procedure.includes("Chứng nhận");
                return (
                  <div key={std.code} className="ui-subpanel ui-subpanel--md ui-stack">
                    <div className="ui-row-between">
                      <StatusBadge tone="brand" icon="tag" size="sm">
                        <span className="ui-mono ui-wrap">{std.code}</span>
                      </StatusBadge>
                      <StatusBadge tone={isCert ? "danger" : "warning"} size="sm">
                        {std.procedure}
                      </StatusBadge>
                    </div>
                    <div className="ui-text-strong ui-wrap">{std.name}</div>
                    <div className="ui-muted">
                      <strong>Chỉ tiêu thử nghiệm:</strong> {std.test_scope}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {currentPlaybook.six_step_workflow && currentPlaybook.six_step_workflow.length > 0 && (
            <div className="ui-stack">
              <h3 className="ui-subhead">3. Quy trình từng bước thực hiện</h3>
              <div className="ui-grid-cards-sm">
                {currentPlaybook.six_step_workflow.map((st) => (
                  <SectionCard key={st.step} tone="subtle" padding="compact">
                    <div className="ui-stack">
                      <div className="ui-row">
                        <span className="ui-step-badge ui-step-badge--pill">{st.step}</span>
                        <span className="ui-text-strong ui-wrap">{st.title}</span>
                      </div>
                      <p className="ui-muted">{st.description}</p>
                    </div>
                  </SectionCard>
                ))}
              </div>
            </div>
          )}

          <div className="ui-stack">
            <h3 className="ui-subhead">4. Dự toán chi phí &amp; lệ phí nhà nước</h3>
            <FormGrid cols={2}>
              <SectionCard
                tone="subtle"
                padding="compact"
                title="Lệ phí Nhà nước (TT 285/2016/TT-BTC)"
                icon="landmark"
              >
                {currentPlaybook.cost_estimate.state_fees?.map((fee, idx) => (
                  <div key={idx} className="std-fee-row">
                    <span>{fee.name}</span>
                    <strong className="ui-mono ui-wrap">{fee.cost}</strong>
                  </div>
                ))}
                <div className="std-fee-total">Tổng lệ phí nhà nước: 300.000 đ</div>
              </SectionCard>

              <SectionCard
                tone="subtle"
                padding="compact"
                title="Chi phí đo kiểm Phòng Lab chỉ định"
                icon="coins"
              >
                {currentPlaybook.cost_estimate.lab_testing_fees?.map((lab, idx) => (
                  <div key={idx} className="std-fee-row">
                    <span>{lab.scope}</span>
                    <strong className="ui-mono ui-wrap">{lab.cost}</strong>
                  </div>
                ))}
                <div className="std-fee-total">
                  Tổng đo kiểm 1 model: {currentPlaybook.cost_estimate.total_lab_cost_range || "—"}
                </div>
              </SectionCard>
            </FormGrid>
          </div>

          <div className="ui-stack">
            <h3 className="ui-subhead">5. Kinh nghiệm thực chiến tiết kiệm chi phí</h3>
            <div className="ui-subpanel ui-subpanel--md">
              <ul className="ui-bullet-list">
                {currentPlaybook.practical_tips.map((tip, idx) => (
                  <li key={idx}>{tip}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
