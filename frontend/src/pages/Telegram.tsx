import { useEffect, useState } from "react";
import { api, type TelegramStatus, type TtsStatus } from "../api";
import {
  AppButton,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  PageHeader,
  PageShell,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  useConfirm,
  useToast,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";

export function Telegram() {
  const toast = useToast();
  const confirmAction = useConfirm();
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
  const [alarmSound, setAlarmSound] = useState("auto");
  const [ttsProvider, setTtsProvider] = useState("auto");
  const [ttsVoice, setTtsVoice] = useState("diem_trinh");
  const [ttsSpeed, setTtsSpeed] = useState(0);
  const [volume, setVolume] = useState(75);

  const [ttsText, setTtsText] = useState(
    "RK Burner\nJob: burn-207-194\nImage: inut-v1.1-rockchip.img\nrkdeveloptool rd hoàn tất; burn image đã an toàn để chuyển bước tiếp theo.",
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
      if (ts && Array.isArray(ts.providers) && ts.voices) {
        setTtsInfo(ts);
        setSpeakerEnabled(ts.telegram_tts_speaker_enabled ?? true);
        setFilterEnabled(ts.telegram_tts_filter_enabled ?? true);
        setRegexPattern(ts.telegram_tts_regex ?? "RK\\s*Burner");
        setAlarmSound(ts.telegram_tts_alarm_sound || "auto");
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

  useEffect(() => {
    void load();
  }, []);

  async function handleSaveConfig() {
    setBusy(true);
    setErr("");
    setNotice("");
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
      const okMsg = `Đã lưu cấu hình. Bộ lọc Regex: /${saved.telegram_tts_regex}/i (${saved.telegram_tts_filter_enabled ? "Bật lọc" : "Đọc tất cả"}) · Còi báo: ${saved.telegram_tts_alarm_sound}`;
      setNotice(okMsg);
      toast.success("Đã lưu cấu hình Regex & loa báo động.");
      const check = await api.ttsTestRegex({
        message: ttsText,
        regex: saved.telegram_tts_regex,
        filter_enabled: saved.telegram_tts_filter_enabled,
      });
      setRegexPreview(check);
      await load();
    } catch (error) {
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
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
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
    }
  }

  async function handleSpeakOnly() {
    if (!ttsText.trim()) return;
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const res = await api.ttsSpeak({
        text: ttsText.trim(),
        provider: ttsProvider,
        voice: ttsVoice,
        speed: ttsSpeed,
        alarm_sound: alarmSound,
      });
      const okMsg = `Đã phát ra loa (${res.provider} · giọng ${res.voice} · còi ${res.alarm_sound} · ${(res.audio_bytes_len / 1024).toFixed(1)} KB ${res.audio_format.toUpperCase()})`;
      setNotice(okMsg);
      toast.success("Đã gửi lệnh phát âm thanh ra loa.");
      await load();
    } catch (error) {
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTelegramAndSpeak() {
    if (!ttsText.trim()) return;
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const check = await api.ttsTestRegex({
        message: ttsText.trim(),
        regex: regexPattern,
        filter_enabled: filterEnabled,
      });
      setRegexPreview(check);
      const res = await api.telegramSend(ttsText.trim(), true);
      const okMsg = check.matched
        ? `Đã gửi Telegram (${res.delivered_count} TK) và khớp Regex /${regexPattern}/i — đang hú còi và đọc TTS ra loa 77.88.207.23.`
        : `Đã gửi Telegram (${res.delivered_count} TK) · Không khớp Regex /${regexPattern}/i nên không kích hoạt loa.`;
      setNotice(okMsg);
      toast.success(okMsg);
    } catch (error) {
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  async function handleVolumeChange(newVol: number) {
    setVolume(newVol);
    try {
      await api.ttsSpeakerVolume(newVol);
      const okMsg = `Đã đặt âm lượng loa: ${newVol}%`;
      setNotice(okMsg);
      toast.success(okMsg);
    } catch (error) {
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
    }
  }

  async function handlePlaySound(snd: string) {
    try {
      await api.ttsSpeakerSound(snd);
      const okMsg = `Đang phát hiệu ứng âm thanh: ${snd}`;
      setNotice(okMsg);
      toast.info(okMsg);
    } catch (error) {
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
    }
  }

  async function handleStopSpeaker() {
    try {
      await api.ttsSpeakerStop();
      const okMsg = "Đã dừng phát loa.";
      setNotice(okMsg);
      toast.info(okMsg);
    } catch (error) {
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
    }
  }

  async function connect() {
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const result = await api.telegramConnect();
      setLink(result.url);
      setExpiresAt(result.expires_at);
      const okMsg = "Đã tạo link một lần. Mở link bằng Telegram rồi bấm Start.";
      setNotice(okMsg);
      toast.success(okMsg);
    } catch (error) {
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const accepted = await confirmAction({
      title: "Ngắt kết nối Telegram",
      message: "Ngắt Telegram khỏi tài khoản KSP này?",
      confirmLabel: "Ngắt kết nối",
      tone: "danger",
    });
    if (!accepted) return;
    setBusy(true);
    setErr("");
    try {
      await api.telegramDisconnect();
      setLink("");
      const okMsg = "Đã ngắt kết nối Telegram.";
      setNotice(okMsg);
      toast.success(okMsg);
      await load();
    } catch (error) {
      const m = (error as Error).message;
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    const okMsg = "Đã sao chép link kết nối.";
    setNotice(okMsg);
    toast.success(okMsg);
  }

  const safeLink = safeHttpUrl(link);

  return (
    <PageShell maxWidth="narrow" data-page="telegram">
      <PageHeader
        variant="compact"
        icon="send"
        eyebrow="NOTIFICATIONS"
        title="Telegram thông báo"
        subtitle="Nhận tin nhắn Messenger mới của fanpage trực tiếp trong Telegram."
        actions={
          status ? (
            <StatusBadge tone={status.connected ? "success" : "neutral"} dot>
              {status.connected ? "Đã kết nối" : "Chưa kết nối"}
            </StatusBadge>
          ) : undefined
        }
      />

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}
      {notice && (
        <InlineAlert tone="success" onDismiss={() => setNotice("")}>
          {notice}
        </InlineAlert>
      )}

      {!status ? (
        <SectionCard>
          <SkeletonBlock variant="line" lines={4} />
        </SectionCard>
      ) : !status.enabled ? (
        <SectionCard>
          <EmptyState
            icon="ban"
            title="Bot chưa được bật"
            description={
              <>
                Quản trị viên cần đặt <code className="ui-code">TELEGRAM_BOT_TOKEN</code> và{" "}
                <code className="ui-code">TELEGRAM_ENABLED=true</code> trong file môi trường rồi
                khởi động lại backend.
              </>
            }
          />
        </SectionCard>
      ) : status.connected ? (
        <SectionCard
          title="Tài khoản Telegram đang nhận thông báo"
          icon="check-circle"
          actions={
            <AppButton
              variant="danger"
              size="sm"
              leftIcon="x"
              loading={busy}
              onClick={disconnect}
            >
              Ngắt kết nối
            </AppButton>
          }
        >
          <div className="ui-stack--sm">
            <p className="ui-muted">
              <strong>{status.display_name || status.username || "Telegram"}</strong>
              {status.username ? ` · @${status.username}` : ""}
            </p>
            <p className="ui-muted">
              Tin nhắn mới sẽ kèm link mở nhanh hộp thư Messenger trong KSP.
            </p>
          </div>
        </SectionCard>
      ) : (
        <SectionCard title={`Kết nối với @${status.bot_username}`} icon="send">
          <div className="ui-stack">
            <EmptyState
              icon="send"
              compact
              title={`Chưa liên kết tài khoản với @${status.bot_username}`}
              description="Nhấn tạo link, mở link bằng Telegram và chọn Start. Link chỉ dùng một lần và hết hạn sau vài phút."
              action={
                <AppButton
                  variant="primary"
                  leftIcon="link"
                  loading={busy}
                  onClick={connect}
                >
                  {busy ? "Đang tạo link…" : "Tạo link đăng nhập Telegram"}
                </AppButton>
              }
            />

            {link && (
              <FormField
                label="Link kết nối"
                htmlFor="tg-connect-link"
                hint={
                  expiresAt
                    ? `Hết hạn: ${new Date(expiresAt).toLocaleString("vi-VN")}`
                    : undefined
                }
              >
                <div className="ui-row">
                  <input
                    id="tg-connect-link"
                    className="ui-input ui-grow"
                    readOnly
                    value={link}
                  />
                  <AppButton variant="secondary" size="sm" leftIcon="copy" onClick={copyLink}>
                    Sao chép
                  </AppButton>
                  {safeLink && (
                    <a
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      href={safeLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở Telegram
                    </a>
                  )}
                </div>
              </FormField>
            )}
          </div>
        </SectionCard>
      )}

      {ttsInfo && (
        <SectionCard
          eyebrow="BLE ALARM & TTS"
          title={`Cấu hình lọc Regex (RK Burner) & Loa báo động BLE (${ttsInfo.ble_speaker_base_url})`}
          subtitle="Chỉ các tin nhắn Telegram khớp biểu thức Regex mới kích hoạt còi báo động và đọc giọng nói Tiếng Việt (Kokoro -> VNMap TTS -> Chị Google -> Microsoft) qua loa 77.88.207.23."
          icon="radio"
          actions={
            <StatusBadge
              tone={ttsInfo.speaker_status?.speaker?.connected ? "success" : "neutral"}
              dot
            >
              {ttsInfo.speaker_status?.speaker?.connected
                ? `Loa ${ttsInfo.speaker_status.speaker.name} · Pin ${ttsInfo.speaker_status.speaker.battery ?? 100}%`
                : "Loa chưa kết nối"}
            </StatusBadge>
          }
        >
          <div className="ui-stack">
            <div className="cm-toggle-bar">
              <label className="ui-check-label">
                <input
                  type="checkbox"
                  checked={speakerEnabled}
                  onChange={(e) => setSpeakerEnabled(e.target.checked)}
                />
                <span>Bật tự động phát loa BLE khi có tin Telegram</span>
              </label>
              <label className="ui-check-label">
                <input
                  type="checkbox"
                  checked={filterEnabled}
                  onChange={(e) => setFilterEnabled(e.target.checked)}
                />
                <span>Chỉ báo động các tin nhắn khớp Regex bên dưới</span>
              </label>
            </div>

            <FormField
              label="Biểu thức Regex lọc tin nhắn báo loa (không phân biệt hoa/thường)"
              htmlFor="tg-regex"
            >
              <div className="ui-row">
                <input
                  id="tg-regex"
                  className="ui-input ui-grow ui-mono"
                  type="text"
                  value={regexPattern}
                  onChange={(e) => setRegexPattern(e.target.value)}
                  placeholder="Ví dụ: RK\s*Burner"
                />
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setRegexPattern("RK\\s*Burner")}
                  title="Chỉ báo tin nhắn RK Burner"
                >
                  Preset: RK Burner
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setRegexPattern("RK\\s*Burner|Hải quan|Thông quan")}
                  title="RK Burner hoặc Hải quan"
                >
                  Preset: RK Burner + Hải quan
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setRegexPattern(".*")}
                  title="Báo mọi tin nhắn"
                >
                  Preset: Tất cả (.*)
                </AppButton>
              </div>
            </FormField>

            <FormGrid cols={2}>
              <FormField label="Âm báo trước khi đọc TTS" htmlFor="tg-alarm-sound">
                <select
                  id="tg-alarm-sound"
                  className="ui-select"
                  value={alarmSound}
                  onChange={(e) => setAlarmSound(e.target.value)}
                >
                  <option value="auto">
                    Tự động (Thành công -&gt; Success · Lỗi/Fail -&gt; Alarm)
                  </option>
                  <option value="success">Luôn phát Success (Hoàn thành)</option>
                  <option value="alarm">Luôn phát Alarm (Còi báo động)</option>
                  <option value="chime">Luôn phát Chime (Chuông báo)</option>
                  <option value="notification">Luôn phát Notification (Ting)</option>
                  <option value="beep">Luôn phát Beep</option>
                  <option value="none">Không phát âm hiệu (Chỉ đọc TTS)</option>
                </select>
              </FormField>

              <FormField label="Nguồn TTS (Fallback Chain)" htmlFor="tg-tts-provider">
                <select
                  id="tg-tts-provider"
                  className="ui-select"
                  value={ttsProvider}
                  onChange={(e) => setTtsProvider(e.target.value)}
                >
                  {ttsInfo.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Giọng đọc Tiếng Việt" htmlFor="tg-tts-voice">
                <select
                  id="tg-tts-voice"
                  className="ui-select"
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                >
                  <optgroup label="Kokoro / VNMap TTS (WAV 24kHz)">
                    {ttsInfo.voices.kokoro.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="AppHub 9Router · Chị Google">
                    {ttsInfo.voices.google.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="AppHub 9Router · Microsoft Edge Neural">
                    {ttsInfo.voices.microsoft.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </FormField>

              <FormField label={`Âm lượng loa (${volume}%)`} htmlFor="tg-volume">
                <div className="ui-row">
                  <input
                    id="tg-volume"
                    className="cm-range"
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                  />
                  <AppButton
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleVolumeChange(volume)}
                  >
                    Đặt
                  </AppButton>
                </div>
              </FormField>
            </FormGrid>

            <div className="ui-row">
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="save"
                loading={busy}
                onClick={handleSaveConfig}
              >
                Lưu cấu hình Regex &amp; Loa
              </AppButton>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="alert-triangle"
                onClick={() => void handlePlaySound("alarm")}
              >
                Thử còi Alarm
              </AppButton>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="bell"
                onClick={() => void handlePlaySound("chime")}
              >
                Thử Chime
              </AppButton>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="check-circle"
                onClick={() => void handlePlaySound("success")}
              >
                Thử Success
              </AppButton>
              <AppButton
                variant="ghost"
                size="sm"
                leftIcon="stop-circle"
                onClick={handleStopSpeaker}
              >
                Dừng loa
              </AppButton>
            </div>

            <hr className="ui-divider" />

            <FormField
              label="Nội dung tin nhắn kiểm thử (Test khớp Regex & Đọc thử ra loa 77.88.207.23)"
              htmlFor="tg-test-message"
            >
              <textarea
                id="tg-test-message"
                className="ui-textarea ui-mono"
                rows={3}
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
              />
            </FormField>

            {regexPreview && (
              <InlineAlert
                tone={regexPreview.matched ? "success" : "info"}
                title={
                  regexPreview.matched
                    ? `KHỚP REGEX (/${regexPreview.regex}/i -> "${regexPreview.matched_text}") — SẼ HÚ CÒI & ĐỌC LOA`
                    : `KHÔNG KHỚP REGEX (/${regexPreview.regex}/i) — CHỈ GỬI TELEGRAM, KHÔNG HÚ LOA`
                }
              >
                Câu đọc TTS dự kiến: <em>“{regexPreview.spoken_preview}”</em>
              </InlineAlert>
            )}

            <div className="ui-row">
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="search"
                disabled={busy}
                onClick={handleTestRegex}
              >
                Kiểm tra khớp Regex
              </AppButton>
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="play"
                loading={busy}
                onClick={handleSpeakOnly}
              >
                Phát thử Còi + Đọc Loa ngay
              </AppButton>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="send"
                className="ui-wrap-btn"
                disabled={busy || !status?.connected}
                onClick={handleSendTelegramAndSpeak}
              >
                Bắn thử Telegram + Phát loa (nếu khớp Regex)
              </AppButton>
            </div>
          </div>
        </SectionCard>
      )}
    </PageShell>
  );
}
