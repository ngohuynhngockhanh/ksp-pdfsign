"""Hệ thống Quản lý Game Gamification "Hành Trình Chinh Phục Hợp Quy iNut".
Lưu trữ tiến độ, Level, EXP, Ghi chú tác chiến và đồng bộ trạng thái 2 chiều với CSDL.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path("/home/ksp/ksp-pdfsign/backend/data/ksp.db")


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_game_db():
    """Khoi tao bang luu tru tien do Game hop quy neu chua co."""
    with _get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS standards_game_quests (
                quest_id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                subtitle TEXT NOT NULL,
                description TEXT NOT NULL,
                ai_companion_tip TEXT NOT NULL,
                secret_cheatsheet TEXT NOT NULL,
                exp_reward INTEGER DEFAULT 500,
                level_title TEXT NOT NULL,
                status TEXT DEFAULT 'pending', -- pending, in_progress, completed
                completed_at TEXT,
                personal_note TEXT DEFAULT ''
            );
            """
        )
        conn.commit()

        # Seed 6 Quests mac dinh neu bang trong
        cur = conn.execute("SELECT COUNT(*) FROM standards_game_quests;")
        if cur.fetchone()[0] == 0:
            default_quests = [
                (
                    1,
                    "Lắp Ráp Chiến Binh Mẫu & Khắc Tên Thương Hiệu",
                    "Chuẩn bị phần cứng hoàn thiện, cổng anten ngoài và tem nhãn sản phẩm",
                    "Lắp bo mạch Rockchip (RK3568/RK3588) vào vỏ nhôm công nghiệp CNC hoặc vỏ DIN-rail, gắn cổng SMA cho anten ngoài 3dBi/5dBi, gắn cổng nguồn 12V-24V DC và dán tem nhãn: 'iNut-RK3568-Industrial-PC - Made in Vietnam'.",
                    "Anh Khánh ơi, hãy nhớ siết chặt ốc vỏ nhôm và đảm bảo chân ren cổng SMA tiếp xúc trực tiếp 100% với vỏ kim loại để lát nữa chống tĩnh điện ESD cực ngọt nhé!",
                    "Kiểm tra tem nhãn đã có đủ: Tên thiết bị, Mã kiểu loại Model, Nguồn điện DC (Không pin), Hãng sản xuất: INUT, Xuất xứ: Việt Nam.",
                    500,
                    "🥉 Tập Sự Hợp Quy (Level 1)",
                    "completed",
                    datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "Đã chốt thiết kế vỏ nhôm CNC cho bo mạch iNut Rockchip RK3568.",
                ),
                (
                    2,
                    "Nạp Firmware Vũ Khí Wi-Fi RF Test Mode",
                    "Tích hợp công cụ phát sóng liên tục đo kiểm tần số và công suất",
                    "Nạp firmware Linux có tích hợp sẵn công cụ RF Test Tool (sử dụng rtwpriv / wl tool) cho phép bật phát sóng liên tục ở Kênh 1, 6, 11 cho 2.4G và Kênh 36, 149 cho 5G qua cổng UART Debug hoặc Web UI.",
                    "Vũ khí RF Test Mode đã lên đạn! Kỹ thuật viên phòng Lab chỉ cần cắm cáp quang phổ và gõ lệnh là đo được ngay, tiết kiệm 50% thời gian!",
                    "Test trước các lệnh phát sóng Wi-Fi 2.4G Kênh 1 (11n MCS7, 18dBm) và Wi-Fi 5G Kênh 36 (11ac MCS7, 17dBm) để đảm bảo sóng phát ổn định.",
                    500,
                    "⚡ Chiến Thần RF & Wi-Fi (Level 2)",
                    "in_progress",
                    None,
                    "Đang tích hợp CLI test mode vào firmware Linux.",
                ),
                (
                    3,
                    "Bắn Zalo Thả Thính Phòng Lab & Chốt Báo Giá",
                    "Gửi thông số máy cho VNTA Lab / Quatest 3 và chốt lịch đo kiểm",
                    "Sử dụng mẫu tin nhắn KSP iNut soạn sẵn gửi Zalo cho VNTA Lab (028.39919191) hoặc Quatest 3 (0903.003.528), nhận Phiếu yêu cầu thử nghiệm và chốt giá đo kiểm 4 quy chuẩn (QCVN 54, 65, 18, 132).",
                    "Anh Khánh bấm nút 'Copy Mẫu Tin Nhắn' trên KSP iNut rồi paste thẳng vào Zalo Quatest 3 là họ rep báo giá và xếp lịch đo ngay trong ngày!",
                    "Miễn hoàn toàn đo kiểm Pin Lithium (QCVN 101) vì máy chạy nguồn ngoài, giúp tiết kiệm ngay 5 - 6 triệu ₫!",
                    500,
                    "🤝 Cao Thủ Đàm Phán Lab (Level 3)",
                    "pending",
                    None,
                    "",
                ),
                (
                    4,
                    "Vượt Ải Buồng Câm EMC & Súng Phóng Tĩnh Điện ESD",
                    "Chinh phục bài thử nghiệm khó nhất tại phòng đo kiểm",
                    "Mang mẫu vào phòng Lab để đo phát xạ bức xạ (Radiated Emissions) trong buồng câm và bắn súng tĩnh điện ESD tiếp xúc 4kV / không khí 8kV. Máy không được treo hay reset. Nhận Test Report đạt chuẩn!",
                    "Anh nhớ mang theo túi cứu hộ thần tốc: Túi lõi Ferit kẹp dây nguồn và cuộn băng keo đồng để kẹp ngay nếu bức xạ mém chạm vạch đỏ nhé!",
                    "Nếu bức xạ gần chạm ngưỡng, kẹp ngay 2 cục Ferit Bead vào sát đầu dây nguồn DC và bật Spread Spectrum Clocking trong Device Tree!",
                    500,
                    "🛡️ Khắc Tinh EMC & Súng ESD (Level 4)",
                    "pending",
                    None,
                    "",
                ),
                (
                    5,
                    "Chinh Phục Cổng Dịch Vụ Công BTTTT Cấp Giấy CNHQ",
                    "Nộp hồ sơ trực tuyến xin cấp Giấy Chứng Nhận Hợp Quy 3 năm",
                    "Đăng nhập Cổng Dịch vụ công Quốc gia (dichvucong.gov.vn), nộp bộ hồ sơ online (Test Report + ĐKKD INUT + User Manual) xin cấp Giấy CNHQ Phương thức 1. Nộp lệ phí 150.000 ₫ và nhận Giấy phép chính thức.",
                    "Không cần nhà máy ISO 9001! Giấy CNHQ Phương thức 1 của Cục Viễn Thông có giá trị 3 năm, thoải mái sản xuất và phân phối!",
                    "Chuẩn bị sẵn file PDF Test Report và ảnh chụp thực tế sản phẩm 6 mặt để upload lên hệ thống dịch vụ công.",
                    500,
                    "📜 Bậc Thầy Chứng Nhận BTTTT (Level 5)",
                    "pending",
                    None,
                    "",
                ),
                (
                    6,
                    "Triệu Hồi Dấu Ấn CR & Ký Số KSP Xuất Trận",
                    "Ban hành Bản Công Bố Hợp Quy và dán tem CR xuất bán ra thị trường",
                    "Vào phân hệ KSP iNut tạo Bản Công Bố Hợp Quy (Mẫu 02 TT28) ký số điện tử KSP, in tem dấu hợp quy CR (kèm mã CNHQ) dán lên thân máy và chính thức mở bán hoặc tham gia đấu thầu dự án lớn!",
                    "CHÚC MỪNG CHIẾN THẦN INUT! Bạn đã hoàn thành 100% hành trình hợp quy hóa thiết bị Made in Vietnam! Tự tin xuất kho và nộp thầu thắng lớn!",
                    "Lưu 01 bản PDF Bản Công Bố Hợp Quy đã ký số vào kho chứng từ KSP để xuất trình khi cơ quan quản lý thị trường kiểm tra.",
                    500,
                    "👑 HUYỀN THOẠI HỢP QUY QUỐC GIA (MAX LEVEL 6)",
                    "pending",
                    None,
                    "",
                ),
            ]
            conn.executemany(
                """
                INSERT INTO standards_game_quests (
                    quest_id, title, subtitle, description, ai_companion_tip,
                    secret_cheatsheet, exp_reward, level_title, status, completed_at, personal_note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                default_quests,
            )
            conn.commit()


class StandardsGameService:
    """Service thao tac logic Game va tien do nhiem vu."""

    @classmethod
    def get_game_state(cls) -> dict[str, Any]:
        """Lay toan bo trang thai Game, Level, EXP va danh sach 6 Quests."""
        init_game_db()
        with _get_db() as conn:
            cur = conn.execute("SELECT * FROM standards_game_quests ORDER BY quest_id ASC;")
            rows = [dict(r) for r in cur.fetchall()]

        completed_count = sum(1 for r in rows if r["status"] == "completed")
        total_quests = len(rows)
        current_exp = completed_count * 500
        max_exp = total_quests * 500

        # Xac dinh level va danh hieu
        levels = [
            "Tập Sự Hợp Quy (Lv.1)",
            "Chiến Thần RF & Wi-Fi (Lv.2)",
            "Cao Thủ Đàm Phán Lab (Lv.3)",
            "Khắc Tinh EMC & Súng ESD (Lv.4)",
            "Bậc Thầy Chứng Nhận BTTTT (Lv.5)",
            "👑 HUYỀN THOẠI HỢP QUY QUỐC GIA (MAX LEVEL 6)",
        ]
        current_level_idx = min(completed_count, len(levels) - 1)
        current_level_title = levels[current_level_idx]

        # AI Companion Cheer Message
        if completed_count == 0:
            ai_cheer = "Chào mừng anh Khánh bước vào Hành Trình Chinh Phục Hợp Quy! Hãy bắt đầu với Ải 1 lắp ráp mẫu nhé!"
        elif completed_count == 1:
            ai_cheer = "Xuất sắc! Đã xong Ải 1! Giờ anh em mình nạp Firmware RF Test Mode để sẵn sàng bắn sóng đo kiểm nhé!"
        elif completed_count == 2:
            ai_cheer = "Tuyệt vời! Vũ khí RF Test Mode đã sẵn sàng! Bắn Zalo cho phòng Lab để chốt lịch đo ngay thôi anh!"
        elif completed_count == 3:
            ai_cheer = "Đã chốt kèo phòng Lab! Chuẩn bị balo đồ nghề lõi Ferit để đưa máy vào buồng câm EMC nhé!"
        elif completed_count == 4:
            ai_cheer = "Vượt ải buồng câm EMC ngoạn mục! Cầm Test Report lên Cổng Dịch vụ công BTTTT nộp lấy Giấy CNHQ nào!"
        elif completed_count == 5:
            ai_cheer = "Giấy CNHQ 3 năm đã về tay! Chỉ còn Ải cuối: Ký số Bản Công Bố CR trên KSP iNut là xuất xưởng bung lụa!"
        else:
            ai_cheer = "👑 ĐỈNH CAO! Anh Khánh đã đạt MAX LEVEL! Thiết bị iNut Rockchip đã có đầy đủ pháp lý vững như bàn thạch!"

        return {
            "current_level": current_level_idx + 1,
            "current_level_title": current_level_title,
            "current_exp": current_exp,
            "max_exp": max_exp,
            "progress_percent": int((completed_count / total_quests) * 100),
            "completed_quests_count": completed_count,
            "total_quests": total_quests,
            "ai_companion_cheer": ai_cheer,
            "quests": rows,
        }

    @classmethod
    def complete_quest(cls, quest_id: int, note: str = "") -> dict[str, Any]:
        """Danh dau hoan thanh 1 Ai nhiem vu, tang EXP va mo khoa ai tiep theo."""
        init_game_db()
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        with _get_db() as conn:
            conn.execute(
                """
                UPDATE standards_game_quests
                SET status = 'completed', completed_at = ?, personal_note = CASE WHEN ? != '' THEN ? ELSE personal_note END
                WHERE quest_id = ?;
                """,
                (now_str, note, note, quest_id),
            )
            # Mo khoa ai tiep theo neu ai do dang pending
            next_id = quest_id + 1
            conn.execute(
                """
                UPDATE standards_game_quests
                SET status = 'in_progress'
                WHERE quest_id = ? AND status = 'pending';
                """,
                (next_id,),
            )
            conn.commit()

        return cls.get_game_state()

    @classmethod
    def update_quest_note(cls, quest_id: int, note: str) -> dict[str, Any]:
        """Cap nhat ghi chu ca nhan cho 1 ai."""
        init_game_db()
        with _get_db() as conn:
            conn.execute(
                "UPDATE standards_game_quests SET personal_note = ? WHERE quest_id = ?;",
                (note, quest_id),
            )
            conn.commit()
        return cls.get_game_state()

    @classmethod
    def reset_game(cls) -> dict[str, Any]:
        """Reset lai toan bo tien do game."""
        init_game_db()
        with _get_db() as conn:
            conn.execute("UPDATE standards_game_quests SET status = 'pending', completed_at = NULL, personal_note = '';")
            conn.execute("UPDATE standards_game_quests SET status = 'in_progress' WHERE quest_id = 1;")
            conn.commit()
        return cls.get_game_state()
