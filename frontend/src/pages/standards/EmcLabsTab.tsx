import {
  AppButton,
  AppIcon,
  FormGrid,
  InlineAlert,
  SectionCard,
  StatusBadge,
} from "../../components/ui";

export function EmcGuideTab() {
  return (
    <div className="ui-stack--lg">
      <SectionCard
        eyebrow="Cẩm nang kỹ thuật phần cứng"
        title="Bí Kíp Thiết Kế Phần Cứng & Kinh Nghiệm Đo Đạt EMC Đậu Ngay Lần Thử Đầu Tiên"
        subtitle="Hơn 70% thiết bị rớt kiểm định BTTTT do không đạt Phát xạ bức xạ (Radiated Emissions) hoặc treo/reset khi bắn tĩnh điện (ESD). Tổng hợp giải pháp chống nhiễu cho bo mạch Rockchip."
        icon="shield-check"
      >
        <div className="ui-stack--lg">
          <FormGrid cols={2}>
            <SectionCard
              tone="subtle"
              padding="compact"
              title="1. Vượt Qua Phát Xạ Bức Xạ (RE: 30MHz - 6GHz)"
              icon="radio"
            >
              <ul className="ui-bullet-list">
                <li>
                  <strong>Lồng Faraday vỏ nhôm:</strong> Các mặt ghép vỏ nhôm phải tiếp xúc điện
                  trực tiếp, không bị lớp sơn tĩnh điện cách điện ở chân ốc.
                </li>
                <li>
                  <strong>Kẹp Lõi Ferit (Ferrite Bead):</strong> Luôn kẹp 1 - 2 cục lọc Ferit ở sát
                  đầu dây nguồn DC và dây mạng để triệt tiêu bức xạ ngoài ý muốn.
                </li>
                <li>
                  <strong>Tuyệt chiêu Firmware:</strong> Bật <em>Spread Spectrum Clocking (SSC)</em>{" "}
                  trong Device Tree Rockchip (rk3568.dtsi) để giảm ngay 3 - 6 dB năng lượng đỉnh
                  sóng hài.
                </li>
              </ul>
            </SectionCard>

            <SectionCard
              tone="subtle"
              padding="compact"
              title="2. Vượt Qua Phóng Tĩnh Điện (ESD ±4kV / ±8kV)"
              icon="zap"
            >
              <ul className="ui-bullet-list">
                <li>
                  <strong>Tách biệt Mass Vỏ &amp; Mass Mạch:</strong> Vỏ nhôm nối Chassis Ground
                  (PE). Digital GND nối với vỏ qua cầu nối: Tụ cao áp 1nF/2kV song song Điện trở
                  1MΩ.
                </li>
                <li>
                  <strong>Diode TVS bảo vệ cổng:</strong> Gắn chip TVS (USBLC6-2SC6, SM712) trên
                  tất cả các chân USB D+/D-, RS485 A/B, Ethernet.
                </li>
                <li>
                  <strong>Chân ren Anten SMA:</strong> Bắt ốc siết chặt tiếp xúc kim loại 100% vào
                  vỏ nhôm để tĩnh điện thoát ngay ra ngoài đất.
                </li>
              </ul>
            </SectionCard>
          </FormGrid>

          <SectionCard
            tone="subtle"
            padding="compact"
            title="Bộ Đồ Nghề Cứu Hộ Nhanh Mang Theo Vào Phòng Lab"
            icon="wrench"
          >
            <div className="ui-grid-cards-sm">
              <div className="ui-subpanel ui-subpanel--md">
                <strong>1. Túi Lõi Ferit kẹp dây:</strong> Kích cỡ 3.5mm, 5mm, 7mm kẹp ngay khi
                bức xạ vượt ngưỡng.
              </div>
              <div className="ui-subpanel ui-subpanel--md">
                <strong>2. Băng keo đồng dẫn điện:</strong> Dán bọc các khe hở tiếp xúc nắp vỏ nhôm
                nếu bị rò sóng.
              </div>
              <div className="ui-subpanel ui-subpanel--md">
                <strong>3. 02 Cục Nguồn Adapter chuẩn:</strong> Loại đạt chuẩn CE/FCC công nghiệp
                để tránh nhiễu nguồn trôi nổi.
              </div>
              <div className="ui-subpanel ui-subpanel--md">
                <strong>4. Laptop + Cáp nạp Debug:</strong> Chỉnh nhanh công suất phát Tx Power
                trong file cấu hình khi cần.
              </div>
            </div>
          </SectionCard>
        </div>
      </SectionCard>
    </div>
  );
}

interface TestingLabsTabProps {
  onCopyZalo: () => void;
}

export function TestingLabsTab({ onCopyZalo }: TestingLabsTabProps) {
  return (
    <div className="ui-stack--lg">
      <InlineAlert
        tone="info"
        title="Mẫu tin nhắn soạn sẵn gửi Zalo / Email cho Phòng Lab"
        action={
          <AppButton variant="primary" size="sm" leftIcon="copy" onClick={onCopyZalo}>
            Sao chép mẫu tin nhắn
          </AppButton>
        }
      >
        Bấm nút sao chép để dán ngay vào Zalo hoặc Email gửi chuyên viên tiếp nhận đo kiểm của
        phòng Lab.
      </InlineAlert>

      <div className="ui-grid-cards-lg">
        <SectionCard
          className="std-card-active"
          title="Trung tâm Đo lường Chất lượng Viễn thông (VNTA Lab)"
          subtitle="Cục Viễn thông — Bộ Thông tin & Truyền thông"
          icon="landmark"
          actions={
            <StatusBadge tone="success" icon="award" size="sm">
              Chỉ định Số 1 BTTTT
            </StatusBadge>
          }
        >
          <div className="ui-stack">
            <div className="ui-stack">
              <div className="ui-inline ui-inline--md">
                <AppIcon name="map-pin" size={15} />
                <span className="ui-text-body">
                  <strong>TP.HCM:</strong> Số 60 Tân Canh, Phường 1, Quận Tân Bình, TP.HCM
                </span>
              </div>
              <div className="ui-inline ui-inline--md">
                <AppIcon name="map-pin" size={15} />
                <span className="ui-text-body">
                  <strong>Hà Nội:</strong> Tòa nhà VNTA, Đường Dương Đình Nghệ, Cầu Giấy, Hà Nội
                </span>
              </div>
            </div>

            <div className="ui-subpanel ui-subpanel--md ui-stack">
              <div className="ui-inline ui-inline--md">
                <AppIcon name="phone" size={15} />
                <span>
                  <strong>Hotline tiếp nhận:</strong>{" "}
                  <a href="tel:02839919191" className="ui-link ui-wrap ui-mono ui-wrap">
                    028.39919191
                  </a>{" "}
                  /{" "}
                  <a href="tel:02437820990" className="ui-link ui-wrap ui-mono ui-wrap">
                    024.37820990
                  </a>
                </span>
              </div>
              <div className="ui-inline ui-inline--md">
                <AppIcon name="mail" size={15} />
                <span>
                  <strong>Email:</strong>{" "}
                  <a href="mailto:testing@vnta.gov.vn" className="ui-link ui-wrap">
                    testing@vnta.gov.vn
                  </a>
                </span>
              </div>
            </div>

            <div className="ui-muted">
              <strong>Phạm vi đo kiểm:</strong> QCVN 54 (Wi-Fi 2.4G/BT), QCVN 65 (Wi-Fi 5G), QCVN
              117 (4G LTE), QCVN 18 (EMC), QCVN 132 (An toàn).
            </div>

            <div className="ui-row-between">
              <StatusBadge tone="neutral" icon="clock" size="sm">
                5 - 7 ngày
              </StatusBadge>
              <StatusBadge tone="warning" icon="coins" size="sm">
                ~15 - 22 Triệu đ / model
              </StatusBadge>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Trung tâm Kỹ thuật Tiêu chuẩn Đo lường Chất lượng 3 (QUATEST 3)"
          subtitle="Tổng cục Tiêu chuẩn Đo lường Chất lượng"
          icon="building-2"
          actions={
            <StatusBadge tone="brand" icon="message-square" size="sm">
              Zalo CSKH nhanh
            </StatusBadge>
          }
        >
          <div className="ui-stack">
            <div className="ui-stack">
              <div className="ui-inline ui-inline--md">
                <AppIcon name="map-pin" size={15} />
                <span className="ui-text-body">
                  <strong>Trụ sở:</strong> 49 Pasteur, Phường Nguyễn Thái Bình, Quận 1, TP.HCM
                </span>
              </div>
              <div className="ui-inline ui-inline--md">
                <AppIcon name="map-pin" size={15} />
                <span className="ui-text-body">
                  <strong>Khu Thí nghiệm:</strong> KCN Biên Hòa 1, Đồng Nai
                </span>
              </div>
            </div>

            <div className="ui-subpanel ui-subpanel--md ui-stack">
              <div className="ui-inline ui-inline--md">
                <AppIcon name="message-square" size={15} />
                <span>
                  <strong>Zalo CSKH:</strong>{" "}
                  <span className="ui-text-strong ui-wrap ui-mono ui-wrap">0903.003.528</span> hoặc{" "}
                  <span className="ui-text-strong ui-wrap ui-mono ui-wrap">0908.574.629</span>
                </span>
              </div>
              <div className="ui-inline ui-inline--md">
                <AppIcon name="phone" size={15} />
                <span>
                  <strong>Tổng đài:</strong>{" "}
                  <a href="tel:02838294274" className="ui-link ui-wrap ui-mono ui-wrap">
                    028.38294274
                  </a>{" "}
                  ·{" "}
                  <a href="mailto:info@quatest3.com.vn" className="ui-link ui-wrap">
                    info@quatest3.com.vn
                  </a>
                </span>
              </div>
            </div>

            <div className="ui-muted">
              <strong>Phạm vi đo kiểm:</strong> Đo kiểm vô tuyến, EMC, an toàn điện, kiểm định môi
              trường.
            </div>

            <div className="ui-row-between">
              <StatusBadge tone="neutral" icon="clock" size="sm">
                5 - 8 ngày
              </StatusBadge>
              <StatusBadge tone="warning" icon="coins" size="sm">
                ~16 - 24 Triệu đ / model
              </StatusBadge>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="ExtendMax Vietnam (Tư Vấn Hợp Quy Trọn Gói)"
          subtitle="Dịch vụ Pre-test và đại diện cấp Giấy CNHQ"
          icon="shield-check"
          actions={
            <StatusBadge tone="warning" size="sm">
              Ủy thác A-Z
            </StatusBadge>
          }
        >
          <div className="ui-stack">
            <div className="ui-inline ui-inline--md">
              <AppIcon name="map-pin" size={15} />
              <span className="ui-text-body">
                Tòa nhà CIC, Phố Nguyễn Thị Duệ, Cầu Giấy, Hà Nội
              </span>
            </div>

            <div className="ui-subpanel ui-subpanel--md ui-stack">
              <div className="ui-inline ui-inline--md">
                <AppIcon name="phone" size={15} />
                <span>
                  <strong>Hotline / Zalo:</strong>{" "}
                  <a href="tel:0915837255" className="ui-link ui-wrap ui-mono ui-wrap">
                    0915.837.255
                  </a>{" "}
                  (hoặc{" "}
                  <a href="tel:02466663066" className="ui-link ui-wrap ui-mono ui-wrap">
                    024.6666.3066
                  </a>
                  )
                </span>
              </div>
              <div className="ui-inline ui-inline--md">
                <AppIcon name="mail" size={15} />
                <span>
                  <strong>Email:</strong>{" "}
                  <a href="mailto:consultant@extendmax.vn" className="ui-link ui-wrap">
                    consultant@extendmax.vn
                  </a>
                </span>
              </div>
            </div>

            <div className="ui-muted">
              <strong>Dịch vụ:</strong> Hỗ trợ test trước (Pre-test), xử lý mạch chống rớt EMC và
              đại diện nộp cấp Giấy CNHQ Cục Viễn Thông.
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
