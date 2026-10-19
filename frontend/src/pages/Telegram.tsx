import { useEffect, useState } from "react";
import { api, type TelegramStatus, type TtsStatus } from "../api";

export function Telegram() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [ttsInfo, setTtsInfo] = useState<TtsStatus | null>(null);
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [regexPattern, setRegexPattern] = useState("RK\\s*Burner");
  const [alarmSound, setAlarmSound] = useState("alarm");
  const [ttsProvider, setTtsProvider] = useState("auto");
  const [ttsVoice, setTtsVoice] = useState("diem_trinh");
  const [ttsSpeed, setTtsSpeed] = useState(0);
  const [volume, setVolume] = useState(75);

  const [ttsText, setTtsText] = useState(
    "✅ RK Burner\nJob: burn-207-194\nImage: inut-v1.1-rockchip.img\nrkdeveloptool rd hoàn tất; burn image đã an toàn để chuyển bước tiếp theo."
  );
  const [regexPreview, setRegexPreview] = useState<{
    matched: boolean;
    regex: string;
    matched_text: string;
    spoken_preview: string;
    reason: string;
  } | null>(null);

  async function load() {
    setErr("");
    try {
      const [tg, ts] = await Promise.all([
        api.telegramStatus(),
        api.ttsStatus().catch(() => null),
      ]);
      setStatus(tg);
      if (ts) {
        setTtsInfo(ts);
        setSpeakerEnabled(ts.telegram_tts_speaker_enabled ?? true);
        setFilterEnabled(ts.telegram_tts_filter_enabled ?? true);
        setRegexPattern(ts.telegram_tts_regex ?? "RK\\s*Burner");
        setAlarmSound(ts.telegram_tts_alarm_sound || "alarm");
        setTtsProvider(ts.default_provider || "auto");
        setTtsVoice(ts.default_voice || "diem_trinh");
        setTtsSpeed(ts.default_speed || 0);
        if (ts.speaker_status?.speaker?.volume != null) {
          setVolume(ts.speaker_status.speaker.volume);
        }
      }
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSaveConfig() {
    setBusy(true); setErr(""); setNotice("");
    try {
      const saved = await api.ttsSaveConfig({
        telegram_tts_speaker_enabled: speakerEnabled,
        telegram_tts_filter_enabled: filterEnabled,
        telegram_tts_regex: regexPattern,
        telegram_tts_alarm_sound: alarmSound,
        tts_default_provider: ttsProvider,
        tts_default_voice: ttsVoice,
        tts_default_speed: ttsSpeed,
      });
      setRegexPattern(saved.telegram_tts_regex);
      setNotice(`💾 Đã lưu cấu hình! Bộ lọc Regex hiện tại: /${saved.telegram_tts_regex}/i (${saved.telegram_tts_filter_enabled ? "Bật lọc" : "Đọc tất cả"}) · Còi báo: ${saved.telegram_tts_alarm_sound}`);
      const check = await api.ttsTestRegex({
        message: ttsText,
        regex: saved.telegram_tts_regex,
        filter_enabled: saved.telegram_tts_filter_enabled,
      });
      setRegexPreview(check);
      await load();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTestRegex() {
    setErr("");
    try {
      const check = await api.ttsTestRegex({
        message: ttsText,
        regex: regexPattern,
        filter_enabled: filterEnabled,
      });
      setRegexPreview(check);
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  async function handleSpeakOnly() {
    if (!ttsText.trim()) return;
    setBusy(true); setErr(""); setNotice("");
    try {
      const res = await api.ttsSpeak({
        text: ttsText.trim(),
        provider: ttsProvider,
        voice: ttsVoice,
        speed: ttsSpeed,
        alarm_sound: alarmSound,
      });
      setNotice(`🔊 Đã phát ra loa (${res.provider} · giọng ${res.voice} · còi ${res.alarm_sound} · ${(res.audio_bytes_len / 1024).toFixed(1)} KB ${res.audio_format.toUpperCase()})`);
      await load();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTelegramAndSpeak() {
    if (!ttsText.trim()) return;
    setBusy(true); setErr(""); setNotice("");
    try {
      const check = await api.ttsTestRegex({
        message: ttsText.trim(),
        regex: regexPattern,
        filter_enabled: filterEnabled,
      });
      setRegexPreview(check);
      const res = await api.telegramSend(ttsText.trim(), true);
      setNotice(
        check.matched
          ? `✈️ Đã bắn Telegram (${res.delivered_count} TK) & KHỚP Regex /${regexPattern}/i → Đang hú còi + đọc TTS ra loa 77.88.207.23!`
          : `✈️ Đã bắn Telegram (${res.delivered_count} TK) · Không khớp Regex /${regexPattern}/i nên KHÔNG hú loa.`
      );
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVolumeChange(newVol: number) {
    setVolume(newVol);
    try {
      await api.ttsSpeakerVolume(newVol);
      setNotice(`🔉 Đã đặt âm lượng loa: ${newVol}%`);
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  async function handlePlaySound(snd: string) {
    try {
      await api.ttsSpeakerSound(snd);
      setNotice(`🎵 Đang phát hiệu ứng âm thanh: ${snd}`);
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  async function handleStopSpeaker() {
    try {
      await api.ttsSpeakerStop();
      setNotice("⏹ Đã dừng phát loa.");
    } catch (error) {
      setErr((error as Error).message);
    }
  }
  async function connect() {
    setBusy(true); setErr(""); setNotice("");
    try {
      const result = await api.telegramConnect();
      setLink(result.url);
      setExpiresAt(result.expires_at);
      setNotice("Đã tạo link một lần. Mở link bằng Telegram rồi bấm Start.");
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Ngắt Telegram khỏi tài khoản KSP này?")) return;
    setBusy(true); setErr("");
    try {
      await api.telegramDisconnect();
      setLink("");
      setNotice("Đã ngắt kết nối Telegram.");
      await load();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setNotice("Đã sao chép link kết nối.");
  }

  if (!status) return <div className="docs-page">{err ? <div className="error">{err}</div> : "Đang tải…"}</div>;

  return (
    <div className="docs-page telegram-page" style={{ maxWidth: 820 }}>
      <header className="page-head">
        <div>
          <span className="eyebrow">NOTIFICATIONS</span>
          <h1>Telegram thông báo</h1>
          <p className="muted">Nhận tin nhắn Messenger mới của fanpage trực tiếp trong Telegram.</p>
        </div>
        <span className={`status-pill ${status.connected ? "ok" : ""}`}>{status.connected ? "Đã kết nối" : "Chưa kết nối"}</span>
      </header>

      {err && <div className="error" role="alert">{err}</div>}
      {notice && <div className="ok-note" role="status">{notice}</div>}

      {!status.enabled ? (
        <section className="panel">
          <h3>Bot chưa được bật</h3>
          <p>Quản trị viên cần đặt <code>TELEGRAM_BOT_TOKEN</code> và <code>TELEGRAM_ENABLED=true</code> trong file môi trường rồi khởi động lại backend.</p>
        </section>
      ) : status.connected ? (
        <section className="panel">
          <h3>Tài khoản Telegram đang nhận thông báo</h3>
          <p><strong>{status.display_name || status.username || "Telegram"}</strong>{status.username ? ` · @${status.username}` : ""}</p>
          <p className="muted">Tin nhắn mới sẽ kèm link mở nhanh hộp thư Messenger trong KSP.</p>
          <button className="telegram-disconnect" disabled={busy} onClick={disconnect}>Ngắt kết nối</button>
        </section>
      ) : (
        <section className="panel">
          <h3>Kết nối với @{status.bot_username}</h3>
          <p>Nhấn tạo link, mở link bằng Telegram và chọn <strong>Start</strong>. Link chỉ dùng một lần và hết hạn sau vài phút.</p>
          <button className="primary" disabled={busy} onClick={connect}>{busy ? "Đang tạo link…" : "Tạo link đăng nhập Telegram"}</button>
          {link && <div style={{ marginTop: 18 }}>
            <label>Link kết nối</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input readOnly value={link} style={{ flex: "1 1 420px" }} />
              <button onClick={copyLink}>Sao chép</button>
              <a className="telegram-open-link" href={link} target="_blank" rel="noreferrer">Mở Telegram</a>
            </div>
            {expiresAt && <small className="muted">Hết hạn: {new Date(expiresAt).toLocaleString("vi-VN")}</small>}
          </div>}
        </section>
      )}

      {ttsInfo && (
        <section className="panel" style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>🔊 Cấu Hình Lọc Regex (RK Burner) &amp; Loa Báo Động BLE ({ttsInfo.ble_speaker_base_url})</h3>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Chỉ những tin nhắn Telegram khớp biểu thức Regex (mặc định <code>RK\s*Burner</code>) mới kích hoạt còi báo động và đọc giọng nói Tiếng Việt (Kokoro → VNMap TTS → Chị Google → Microsoft) qua loa tại <code>77.88.207.23</code>.
              </p>
            </div>
            <span className={`status-pill ${ttsInfo.speaker_status?.speaker?.connected ? "ok" : ""}`}>
              {ttsInfo.speaker_status?.speaker?.connected
                ? `Loa ${ttsInfo.speaker_status.speaker.name} · Pin ${ttsInfo.speaker_status.speaker.battery ?? 100}%`
                : "Loa chưa kết nối"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 14, padding: "10px 12px", background: "var(--bg-soft, #f8fafc)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, cursor: "pointer", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={speakerEnabled}
                onChange={(e) => setSpeakerEnabled(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span>Bật tự động phát loa BLE khi có tin Telegram</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, cursor: "pointer", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={filterEnabled}
                onChange={(e) => setFilterEnabled(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span>Chỉ báo động các tin nhắn khớp Regex bên dưới</span>
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <label>Biểu thức Regex lọc tin nhắn báo loa (Không phân biệt hoa/thường - Case Insensitive)</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
              <input
                type="text"
                value={regexPattern}
                onChange={(e) => setRegexPattern(e.target.value)}
                placeholder="Ví dụ: RK\s*Burner"
                style={{ flex: "1 1 320px", fontFamily: "monospace", fontWeight: 700 }}
              />
              <button type="button" onClick={() => setRegexPattern("RK\\s*Burner")} title="Chỉ báo tin nhắn RK Burner">
                Preset: RK Burner
              </button>
              <button type="button" onClick={() => setRegexPattern("RK\\s*Burner|Hải quan|Thông quan")} title="RK Burner hoặc Hải quan">
                Preset: RK Burner + Hải quan
              </button>
              <button type="button" onClick={() => setRegexPattern(".*")} title="Báo mọi tin nhắn">
                Preset: Tất cả (.*)
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginTop: 14 }}>
            <div>
              <label>Còi báo động trước khi đọc</label>
              <select value={alarmSound} onChange={(e) => setAlarmSound(e.target.value)} style={{ width: "100%" }}>
                <option value="alarm">🚨 Alarm (Còi báo động)</option>
                <option value="chime">🔔 Chime (Chuông báo)</option>
                <option value="notification">💬 Notification (Ting)</option>
                <option value="success">🎉 Success (Hoàn thành)</option>
                <option value="beep">⚡ Beep</option>
                <option value="none">🔇 Không phát còi (Chỉ đọc TTS)</option>
              </select>
            </div>
            <div>
              <label>Nguồn TTS (Fallback Chain)</label>
              <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)} style={{ width: "100%" }}>
                {ttsInfo.providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Giọng đọc Tiếng Việt</label>
              <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} style={{ width: "100%" }}>
                <optgroup label="Kokoro / VNMap TTS (WAV 24kHz)">
                  {ttsInfo.voices.kokoro.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </optgroup>
                <optgroup label="AppHub 9Router · Chị Google">
                  {ttsInfo.voices.google.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </optgroup>
                <optgroup label="AppHub 9Router · Microsoft Edge Neural">
                  {ttsInfo.voices.microsoft.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label>Âm lượng loa ({volume}%)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <button type="button" onClick={() => handleVolumeChange(volume)}>Đặt</button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="primary" type="button" disabled={busy} onClick={handleSaveConfig}>
              💾 Lưu cấu hình Regex &amp; Loa
            </button>
            <button type="button" onClick={() => handlePlaySound("alarm")}>🚨 Thử còi Alarm</button>
            <button type="button" onClick={() => handlePlaySound("chime")}>🔔 Thử Chime</button>
            <button type="button" onClick={() => handlePlaySound("success")}>🎉 Thử Success</button>
            <button type="button" onClick={handleStopSpeaker}>⏹ Dừng loa</button>
          </div>

          <hr style={{ margin: "18px 0", border: 0, borderTop: "1px solid var(--border)" }} />

          <div>
            <label>Nội dung tin nhắn kiểm thử (Test khớp Regex &amp; Đọc thử ra loa 77.88.207.23)</label>
            <textarea
              rows={3}
              value={ttsText}
              onChange={(e) => setTtsText(e.target.value)}
              style={{ width: "100%", marginTop: 4, fontFamily: "monospace" }}
            />
          </div>

          {regexPreview && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${regexPreview.matched ? "#86efac" : "#cbd5e1"}`,
                background: regexPreview.matched ? "#f0fdf4" : "#f8fafc",
                fontSize: 13,
              }}
            >
              <div>
                <strong>
                  {regexPreview.matched
                    ? `✅ KHỚP REGEX (/${regexPreview.regex}/i → "${regexPreview.matched_text}") — SẼ HÚ CÒI & ĐỌC LOA`
                    : `⏭ KHÔNG KHỚP REGEX (/${regexPreview.regex}/i) — CHỈ GỬI TELEGRAM, KHÔNG HÚ LOA`}
                </strong>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                Câu đọc TTS dự kiến: <em>“{regexPreview.spoken_preview}”</em>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" disabled={busy} onClick={handleTestRegex}>
              🔍 Kiểm tra khớp Regex
            </button>
            <button className="primary" type="button" disabled={busy} onClick={handleSpeakOnly}>
              🗣 Phát thử Còi + Đọc Loa ngay
            </button>
            <button type="button" disabled={busy || !status.connected} onClick={handleSendTelegramAndSpeak}>
              ✈️ Bắn thử Telegram + Phát loa (nếu khớp Regex)
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
