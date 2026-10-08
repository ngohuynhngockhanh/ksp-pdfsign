# iNut Smartcity Data Logger Version 1.1
## Tài Liệu Đặc Tả Kỹ Thuật & Hướng Dẫn Tích Hợp Hệ Thống (Technical Datasheet)
**Mã hiệu sản phẩm (Model):** `iNut-SmartCity-v1.1` | **Phân khúc:** Industrial Edge Computing & Telemetry Gateway  
**Đơn vị sở hữu công nghệ & Nhà sản xuất:** CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT (INUT Technology)  
**Mã số thuế:** `4401053694` | **Chứng nhận pháp lý:** Doanh nghiệp Khoa học và Công nghệ năm 2019  
**Website:** `https://inut.vn` | `https://p2p.inut.io.vn` | **Hotline kỹ thuật:** `0972.768.491`

---

## 1. TỔNG QUAN SẢN PHẨM (PRODUCT OVERVIEW)

**iNut Smartcity Data Logger Version 1.1** là thiết bị cổng truyền thông và thu thập dữ liệu biên (Industrial IoT Edge Gateway / Data Logger) hiệu năng cao, được nghiên cứu, thiết kế và làm chủ công nghệ hoàn toàn bởi **INUT Technology**. Thiết bị là kết quả chuyển giao và thương mại hóa thành công từ Đề tài nghiên cứu khoa học công nghệ độc quyền, được Sở Khoa học và Công nghệ cấp **Giấy chứng nhận Doanh nghiệp Khoa học và Công nghệ năm 2019**.

Sản phẩm được định hình cho các ứng dụng công nghiệp khắc nghiệt: quan trắc khí tượng thủy văn hồ đập thủy lợi/thủy điện, giám sát điện mặt trời và năng lượng tái tạo, tự động hóa dây chuyền sản xuất nhà máy thông minh, và trạm dịch vụ công số hóa.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   iNut Smartcity Data Logger v1.1 - Edge Gateway                 │
│                                                                                  │
│   ┌───────────────────────────────┐      ┌───────────────────────────────────┐   │
│   │   TÍNH TOÁN BIÊN HIỆU NĂNG    │      │    BẢO VỆ PHẦN CỨNG ĐA TẦNG       │   │
│   │   • Lõi Rockchip RK3518-eMCP  │      │    • SPD Chống sét lan truyền     │   │
│   │   • Quad-core ARM Cortex-A53  │      │    • Nguồn công nghiệp 9 - 36 VDC │   │
│   │   • RAM + Flash eMCP nguyên   │      │    • Cách ly quang RS485 2.5 kV   │   │
│   │     khối chống rung chấn      │      │    • Tản nhiệt thụ động Fanless   │   │
│   └──────────────┬────────────────┘      └─────────────────┬─────────────────┘   │
│                  │                                         │                     │
│                  ▼                                         ▼                     │
│   ┌───────────────────────────────┐      ┌───────────────────────────────────┐   │
│   │    TRUYỀN THÔNG ĐA PHƯƠNG     │      │   PHẦN MỀM PURE GO TỐI ƯU         │   │
│   │   • Modbus RTU / TCP Master   │      │    • RAM RingBuffer 7.200 điểm    │   │
│   │   • Fast Ethernet 10/100M     │      │    • Hàng đợi Offline 50.000 mẫu  │   │
│   │   • Wi-Fi 2.4GHz + Tùy chọn 4G│      │    • P2P Tunnel Yamux (:31797)    │   │
│   │   • MQTTS TLS 1.3 / FTP TT10  │      │    • Dual-Clock RTC Drift Sync    │   │
│   └───────────────────────────────┘      └───────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Các Đặc Tính Đột Phá:
1. **Lõi Xử Lý Nhúng Tích Hợp RK3518-eMCP**: Trang bị bộ vi xử lý Quad-core ARM 64-bit kết hợp kiến trúc bộ nhớ tích hợp eMCP (Embedded Multi-Chip Package) đặt trên cùng một đế bán dẫn, triệt tiêu nguy cơ bong chân chip khi lắp đặt trên các công trình rung chấn mạnh (đập xả lũ, trạm bơm, tủ máy biến áp).
2. **Khối Bảo Vệ Chống Sét Lan Truyền SPD Tích Hợp (IEC 61000-4-5)**: Mạch lọc đa tầng kết hợp Biến trở oxit kim loại (MOV), Ống phóng điện khí (GDT) và Đi-ốt triệt xung TVS công suất cao, chịu xung sét danh định $\ge 6\text{ kV} / 10\text{ kA}$, bảo vệ an toàn tuyệt đối cho đường nguồn và đường truyền tín hiệu RS485 ngoài trời.
3. **Phần Mềm Lõi Pure Go 100% (Zero-CGO)**: Biên dịch tĩnh duy nhất (~11MB), hoạt động bền bỉ 24/7 với phần cứng Watchdog timer tự phục hồi.
4. **Bảo Vệ Bộ Nhớ Flash eMMC Triệt Để**: Dữ liệu tức thời lưu trữ trên RAM Circular RingBuffer (7.200 điểm đo, 0 disk writes); phân vùng SQLite WAL ghi cụm định kỳ và giải phóng bộ nhớ cũ trực tiếp, triệt tiêu nguy cơ chai cell flash eMMC.
5. **Đường Hầm Đảo Ngược iNut P2P**: Kết nối trực tiếp xuyên qua tường lửa NAT/CGNAT qua cổng chuẩn `31797`, cho phép điều khiển từ xa thời gian thực với độ trễ $< 50\text{ms}$ mà không cần mở port modem hoặc đăng ký IP tĩnh.

---

## 2. BẢNG THÔNG SỐ KỸ THUẬT CHI TIẾT (SPECIFICATIONS)

### 2.1. Năng Lực Xử Lý & Bộ Nhớ
| Thông số | Chi tiết đặc tả kỹ thuật |
|:---|:---|
| **Bộ vi xử lý trung tâm (CPU)** | Rockchip RK3518 Industrial Core, Quad-core ARM Cortex-A53 64-bit, xung nhịp 1.5 GHz – 2.0 GHz |
| **Kiến trúc phần cứng** | Bo mạch nhúng công nghiệp nguyên khối, hỗ trợ tính toán biên (Edge Computing) |
| **Bộ nhớ tích hợp (Memory)** | **eMCP Công Nghiệp (Embedded Multi-Chip Package)** tích hợp nguyên khối RAM và Flash |
| **Bộ nhớ RAM** | 1 GB / 2 GB LPDDR3/LPDDR4 (Tùy chọn nâng cấp 4GB cho tác vụ phức hợp) |
| **Bộ nhớ lưu trữ (Storage)** | 8 GB / 16 GB eMMC 5.1 Flash công nghiệp (Tích hợp thuật toán Wear-Leveling) |
| **Độ tin cậy lưu trữ** | Chống sụt nguồn đột ngột (Power-loss Protection), bảo toàn nguyên vẹn CSDL |

### 2.2. Giao Tiếp Ngoại Vi & Cảm Biến
| Giao tiếp | Quy cách & Chuẩn kết nối |
|:---|:---|
| **Cổng Nối Tiếp (Serial Port)** | 01 x RS485 Half-Duplex (Tùy chọn mở rộng 02 x RS485) |
| **Cách ly bảo vệ Serial** | Cách ly quang điện từ trường (Galvanic Isolation lên đến 2.5 kV) |
| **Tốc độ truyền (Baudrate)** | 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200 bps; Tích hợp trở kết thúc 120Ω |
| **Cổng Mạng Dây (Ethernet)** | 01 x RJ45 10/100 Mbps Fast Ethernet, tích hợp biến áp cách ly từ tính 1.5 kV |
| **Mạng Không Dây (Wi-Fi)** | Wi-Fi 2.4 GHz IEEE 802.11 b/g/n, công suất phát 18 dBm, đầu nối ăng-ten ngoài SMA |
| **Mạng Di Động (4G LTE Tùy chọn)**| Khe cắm Nano-SIM; Tích hợp module vi mạch di động công nghiệp (A7680C-LNNV/LNNY) hỗ trợ đầy đủ các nhà mạng Viettel, VNPT, MobiFone; kèm ăng-ten AH3G.403 |
| **Cổng USB Host / OTG** | 01 – 02 x USB 2.0 Type-A Host (Hỗ trợ máy quét tài liệu SANE, đầu đọc CCCD, USB Drive) |
| **Ngõ Vào Số (Digital Inputs)** | 02 x DI cách ly quang, hỗ trợ đếm xung tần số cao (High-speed Pulse Counter $\le 10\text{kHz}$) |
| **Ngõ Ra Điều Khiển (Relay)** | 01 x Relay Output (Tiếp điểm khô 250VAC 3A / 30VDC 3A) điều khiển bơm, còi báo động |

### 2.3. Nguồn Cấp & Khối Chống Sét Lan Truyền (Power & Surge Protection)
| Tham số | Giá trị định mức |
|:---|:---|
| **Điện áp nguồn danh định** | **`9 – 36 VDC`** (Nguồn công nghiệp một chiều dải siêu rộng) |
| **Bảo vệ mạch nguồn** | Chống cắm ngược cực (Reverse Polarity), chống quá áp, chống sụt áp tức thời |
| **Công suất tiêu thụ** | Chế độ tĩnh: $\le 2.0\text{W}$; Chế độ phát sóng cực đại (kèm 4G LTE): $\le 5.5\text{W}$ |
| **Khối bảo vệ chống sét (SPD)** | Tích hợp đa tầng: Đi-ốt TVS công suất lớn + Ống phóng điện khí GDT + Biến trở MOV |
| **Khả năng chịu xung sét** | Tuân thủ tiêu chuẩn quốc tế **IEC 61000-4-5**: Xung vi sai $\ge 2\text{kV}$, Xung đồng pha $\ge 6\text{kV} / 10\text{kA}$ |
| **Bảo vệ tiếp địa** | Cọc tiếp địa vỏ máy chuyên dụng, điện trở tiếp địa khuyến nghị $R \le 4\Omega$ (hoặc $\le 10\Omega$ TCVN 9385) |

### 2.4. Tiêu Chuẩn Cơ Khí & Môi Trường Hoạt Động
| Tham số | Đặc tả |
|:---|:---|
| **Nhiệt độ hoạt động** | **`-20°C đến +70°C`** (Đạt chuẩn công nghiệp mở rộng) |
| **Nhiệt độ lưu kho** | `-40°C đến +85°C` |
| **Độ ẩm môi trường** | 5% đến 95% RH (Không ngưng tụ ẩm) |
| **Cơ chế tản nhiệt** | Tản nhiệt tự nhiên qua thân vỏ hợp kim nhôm đúc (Fanless 100% không quạt) |
| **Phương thức lắp đặt** | Gắn thanh ray tiêu chuẩn công nghiệp **DIN-Rail 35mm** hoặc bắt vít bảng điện |
| **Kích thước vật lý** | $115\text{ mm} \times 90\text{ mm} \times 40\text{ mm}$ (Gọn nhẹ, tối ưu không gian tủ điều khiển) |
| **Cấp bảo vệ vỏ** | IP30 / IP54 (Khi lắp đặt trong tủ composite/nhựa ABS ngoài trời đạt chuẩn IP66/IP67) |

---

## 3. KIẾN TRÚC PHẦN MỀM & THUẬT TOÁN ĐIỆN TOÁN BIÊN

### 3.1. Ngăn Xếp Hệ Thống (Software Stack Architecture)
* **Kernel & OS**: Linux LTS 5.10 / 6.1 (Kiến trúc ARM64), phân quyền dịch vụ Rootless, Hardware Watchdog Timer $\le 30\text{s}$.
* **Thuật toán quét Modbus (2-Block Register Polling)**: Tự động gom cụm thanh ghi theo 2 block tối ưu, phân định chu kỳ đọc linh hoạt theo trạng thái ban ngày/ban đêm giúp giảm tải bus RS485 đến 70%.
* **Đồng bộ thời gian kép (Dual-Clock Engine)**: Tự động phát hiện và cảnh báo trôi đồng hồ nội bộ giữa cảm biến hiện trường và máy chủ NTP/RTC (`drift_seconds > 60s`), tự động gửi lệnh hiệu chỉnh thanh ghi holding theo chuẩn thời gian quan trắc môi trường.
* **Cơ chế lưu đệm Flash an toàn (Anti-Wear Flash Storage)**:
  * Vòng đệm RAM Circular RingBuffer 7.200 điểm đo phục vụ biểu đồ live mà không tốn chu kỳ ghi đĩa.
  * Hàng đợi ngoại tuyến `sync_queue.db` lưu tới 50.000 bản ghi kèm bộ ngắt mạch Circuit Breaker 4 trạng thái (`CLOSED`, `OPEN`, `HALF_OPEN`, `DRAINING`) tự động phục hồi và bù số liệu khi có mạng.
* **Đường hầm bảo mật P2P Yamux (`inut-p2p`)**:
  * Chạy dịch vụ daemon trên cổng `31797`, đảo ngược kết nối về Central Hub.
  * Cấp phát tài nguyên FRPC Lease có thời hạn, tự thu hồi và xóa cấu hình khi hoàn thành tác vụ.
  * Ghi nhật ký kiểm toán bất biến theo chuẩn An ninh Bộ Công An (BCA Audit Log) sử dụng chuỗi băm Merkle Tree SHA-256.
* **Nền tảng AppHub OTA**: Cập nhật firmware và ứng dụng từ xa an toàn độc lập với kho ứng dụng bên thứ ba, xác thực chữ ký mật mã Ed25519 và tự động rollback khi gặp sự cố.

---

## 4. MA TRẬN ỨNG DỤNG THỰC TẾ (APPLICATION MATRIX)

Thiết bị **iNut Smartcity Data Logger v1.1** được kiểm chứng và vận hành thực tế qua 4 kịch bản công nghiệp trọng điểm:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   HỆ SINH THÁI ỨNG DỤNG iNut Smartcity Data Logger                     │
├──────────────────────────┬──────────────────────────┬──────────────────────────────────┤
│ 1. QUAN TRẮC THỦY LỢI    │ 2. ĐIỆN MẶT TRỜI (SOLAR) │ 3. TỰ ĐỘNG HÓA NHÀ MÁY (OPC)     │
│  • Đập hồ chứa thủy điện │  • Inverter Solis/Senergy│  • PLC Siemens, Schneider, Omron │
│  • Radar nước FMCW 80GHz │  • Giám sát chuỗi PV     │  • OPC UA Server/Client nhúng    │
│  • Vũ kế đo mưa gầu lật  │  • Viễn trắc ThingsBoard │  • In-memory tagStore siêu tốc   │
│  • Cống xả kéo dây       │  • Đồng bộ VNPT Solar NMS│  • Web SCADA giám sát thời gian  │
│  • Xuất tệp FTP TT10     │  • Quét ARP MAC tự động  │    thực tại chỗ                  │
├──────────────────────────┴──────────────────────────┴──────────────────────────────────┤
│ 4. HỆ THỐNG KIOSK & DỊCH VỤ CÔNG SỐ                                                    │
│  • Quản lý thiết bị ngoại vi USB qua AppHub Container                                  │
│  • Máy quét tài liệu chuyên dụng Fujitsu fi-7160 (Giao thức SANE net port :6566)       │
│  • Đầu đọc thẻ Căn cước công dân gắn chip chuyên dụng Hanel HN212 (:2080), VeriBOX S   │
│  • Truyền phát màn hình điều hành từ xa qua WebRTC và WebSocket bảo mật cao            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Ứng dụng 1: Quan Trắc Khí Tượng Thủy Văn & An Toàn Đập Hồ Chứa
* **Dự án thực tế bảo chứng**: Gói thầu Hồ chứa Thủy lợi Sơn La (`IB2600557773` - Hạng mục 17) tại 4 hồ Bản Mòn, Suối Hòm, Suối Chiếu, Chiềng Khoi.
* **Cảm biến kết nối**:
  * Cảm biến radar đo mực nước hồ và hạ lưu HCRZ-LD100-A2 (dải đo 70m, sai số $\pm 3\text{mm}$, RS485 IP67).
  * Vũ kế đo mưa gầu lật RD-RG-S (ngõ vào xung đếm DI tốc độ cao, độ phân giải 0.1mm).
  * Cảm biến kéo dây đo độ mở cống xả nước MPS-M-3000MM-A2 (dải 3000mm, vỏ bảo vệ ngoài trời IP65).
* **Hiệu quả**: Hoạt động hoàn toàn tự động bằng nguồn pin mặt trời và ắc quy trạm thủy lợi, chịu dông sét vùng núi cao, định kỳ tự động đóng gói tệp .txt UTF-8 truyền về máy chủ Sở TN&MT theo Thông tư 10/2021/TT-BTNMT.

### Ứng dụng 2: Giám Sát Điện Mặt Trời & Năng Lượng Tái Tạo
* **Dự án thực tế bảo chứng**: Hệ thống viễn trắc năng lượng `inut-solar-monitor` tại các trạm thực địa `station_7_55`, `THANH-HOA-TEST_2`, máy chủ Fleet Hub `77.88.208.17`.
* **Khả năng tích hợp**:
  * Kết nối trực tiếp dàn biến tần công nghiệp Solis (Block 33000–33099), Senergy qua Modbus TCP/RTU.
  * Tự động quét và gán IP biến tần qua bảng ARP (`/proc/net/arp`).
  * Thuật toán kẹp áp standby chuỗi PV chiều tối chống crash đồ thị, phân định Live UTS và Replay UTS đồng bộ lên nền tảng ThingsBoard và VNPT CSHT Solar NMS.

### Ứng dụng 3: Tự Động Hóa Nhà Máy & Cổng Giao Tiếp OPC/SCADA
* **Dự án thực tế bảo chứng**: Nền tảng điều phối công nghiệp `inut-opc` tích hợp hệ thống 9Router.
* **Khả năng tích hợp**:
  * Khối `tagStore` in-memory quản lý hàng nghìn tags dữ liệu mili-giây không gây nghẽn đĩa.
  * Cầu nối đa năng: OPC UA Server, OPC XML-DA (`:8895`), OPC DA Classic COM Bridge cho SCADA thế hệ cũ và MQTT Bridge cho nhà máy thông minh Industry 4.0.

### Ứng dụng 4: Kiosk Thông Minh & Trình Diễn Dịch Vụ Công
* **Dự án thực tế bảo chứng**: Nền tảng quản lý Kiosk và AppHub `inut-apphub`.
* **Khả năng tích hợp**:
  * Tích hợp máy quét tài liệu tự động Fujitsu fi-7160 (giao thức SANE net port `:6566`).
  * Đầu đọc thẻ CCCD gắn chip Hanel HN212 (`:2080`) và VeriBOX S (`:2081`), nhận diện dữ liệu dân cư tại biên.
  * Điều phối ứng dụng độc lập, phân phối cập nhật OTA qua chữ ký Ed25519 và relay màn hình điều hành từ xa qua WebRTC.

---

## 5. BẢNG QUẢN LÝ PHIÊN BẢN (VERSION MANAGEMENT & ROADMAP)

Để đảm bảo khả năng mở rộng và nâng cấp đồng bộ cho các dự án dài hạn, INUT Technology thiết lập bảng quản lý phiên bản phần cứng và phần mềm chuẩn hóa:

| Phiên bản | Năm phát hành | Bộ xử lý & Bộ nhớ | Tính năng phần cứng chính | Nền tảng phần mềm lõi | Trạng thái vòng đời |
|:---:|:---:|:---|:---|:---|:---:|
| **v1.0** | 2021 | ESP32 / RK3318 Core<br>512MB RAM, 4GB Flash | 01 x RS485 đơn, nguồn 12VDC, Wi-Fi 2.4GHz | Modbus RTU, MQTT Client đơn giản, cấu hình tĩnh | *Legacy (Bảo trì)* |
| **v1.1** *(Bản hiện tại)* | **2024 – 2026** | **Rockchip RK3518-eMCP**<br>**1GB/2GB RAM, 8GB/16GB eMMC** | **Nguồn rộng 9-36VDC, SPD chống sét 6kV tích hợp, RS485 cách ly 2.5kV, 10/100M LAN, Wi-Fi** | **Pure Go Core, RAM RingBuffer 7.200 mẫu, Offline Queue 50.000 bản ghi, P2P Tunnel Yamux, Đồng bộ thời gian kép** | **Active (Sản xuất chính thức - Hồ sơ thầu Sơn La IB2600557773)** |
| **v1.2** | 2026 | Rockchip RK3518-eMCP<br>2GB RAM, 16GB/32GB eMMC | Bổ sung module 4G LTE công nghiệp (A7680C), ăng-ten chuyên dụng AH3G.403, 02 cổng RS485 | Tích hợp thư viện Inverter Solis/Senergy, quét ARP subnet, Web SPA Floating Save Bar | *Sẵn sàng theo đơn đặt hàng (Bảo Toàn Tech & Solar)* |
| **v2.0** *(Định hướng)* | 2027+ | Quad-core ARM 64-bit Core<br>4GB RAM, 32GB/64GB eMMC | 02 x RS485 Isolated, 02 x GbE LAN, NPU tăng tốc AI tại biên 1.0 TOPS, GPS/GNSS định vị | Toàn diện OPC UA Server/Client, Containerized AppHub OTA, An ninh mạng BCA Audit Merkle Tree SHA-256 | *Roadmap R&D* |

---

## 6. SƠ ĐỒ CHÂN KẾT NỐI & HƯỚNG DẪN ĐẤU NỐI (PINOUT & WIRING)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       SƠ ĐỒ CỔNG GIAO TIẾP VẬT LÝ V1.1                          │
│                                                                                 │
│   [ POWER 9-36VDC ]     [ RS485 ISOLATED ]        [ DI & RELAY ]       [ LAN ]  │
│   ┌───┬───┬───────┐     ┌───┬───┬────────┐     ┌───┬───┬─────┬──────┐   ┌─────┐ │
│   │V+ │V- │  GND  │     │ A+│ B-│  GND_I │     │DI1│DI2│COM_I│NO /COM│   │RJ45 │ │
│   └───┴───┴───────┘     └───┴───┴────────┘     └───┴───┴─────┴──────┘   └─────┘ │
│     │   │     │           │   │     │           │   │     │      │        │     │
│     ▼   ▼     ▼           ▼   ▼     ▼           ▼   ▼     ▼      ▼        ▼     │
│   Nguồn Dương/Âm      RS485 A/B Cảm biến      Đếm xung   Điều khiển  Mạng trạm  │
│   và Tiếp địa tủ      (Radar/Cống xả/Mưa)     gầu mưa    bơm/còi hú  hoặc PC    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

1. **Đấu nối nguồn điện**:
   * Cực dương nguồn ($+9\text{V} \sim +36\text{VDC}$) đấu vào chân `V+`.
   * Cực âm nguồn ($0\text{V}$) đấu vào chân `V-`.
   * Chân `GND` vỏ máy bắt buộc đấu nối trực tiếp bằng cáp đồng $\ge 2.5\text{mm}^2$ về cọc bãi tiếp địa tủ điện để bộ chống sét lan truyền SPD hoạt động hiệu quả.
2. **Đấu nối tín hiệu cảm biến RS485**:
   * Dây tín hiệu $A (+)$ của cảm biến radar/áp suất/mưa đấu vào chân `A+`.
   * Dây tín hiệu $B (-)$ của cảm biến đấu vào chân `B-`.
   * Chân `GND_I` dùng để đấu lớp vỏ bọc chống nhiễu (Shielded twisted pair) của cáp tín hiệu.

---

## 7. BẢO CHỨNG PHÁP LÝ & CAM KẾT CHẤT LƯỢNG (WARRANTY & LEGAL)

* **Nguồn gốc xuất xứ**: Sản phẩm sản xuất tại **Việt Nam** bởi **CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT**.
* **Bảo vệ bí quyết công nghệ**: Mạch PCBA và kiến trúc nhúng RK3518-eMCP được phát triển độc quyền theo chương trình R&D của INUT Technology, không chia sẻ thiết kế phần cứng thô ra bên ngoài nhằm bảo vệ bí mật kinh doanh.
* **Tiêu chuẩn chất lượng**:
  * Đạt tiêu chuẩn an toàn điện và tương thích điện từ công nghiệp theo quy định của Bộ Khoa học và Công nghệ và Bộ Thông tin và Truyền thông.
  * Khối chống sét lan truyền tuân thủ tiêu chuẩn quốc tế **IEC 61000-4-5**.
* **Chính sách bảo hành**: Bảo hành chính hãng **24 tháng** đối với toàn bộ phần cứng; cam kết duy trì phụ tùng thay thế và dịch vụ kỹ thuật tối thiểu **05 năm** liên tục.

----------------------------------------------------------------------
*© 2026 CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT. TẤT CẢ CÁC QUYỀN ĐƯỢC BẢO LƯU.*
