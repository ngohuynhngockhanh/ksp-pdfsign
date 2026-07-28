import { FormEvent, useEffect, useState } from "react";
import { api, TrainingAnswer, TrainingEvidence, TrainingSearchResult } from "../api";

const QUICK_QUESTIONS = [
  "Cài FRPC lỗi giờ sao?",
  "iNut PC kết nối Modbus TCP thế nào?",
  "iNut Datalogger phù hợp cho bài toán nào?",
  "Giá iNut RS485 hiện tại bao nhiêu?",
];

function EvidenceList({ title, items }: { title: string; items?: TrainingEvidence[] }) {
  if (!items?.length) return null;
  return (
    <section className="training-evidence">
      <h3>{title}</h3>
      {items.map((item, index) => (
        <a href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}>
          <span>{item.timestamp || title === "Video thực hành" ? item.timestamp || "VIDEO" : "TÀI LIỆU"}</span>
          <strong>{item.title}</strong>
          {item.quote && <small>{item.quote}</small>}
        </a>
      ))}
    </section>
  );
}

function NarrativeAnswer({ text }: { text: string }) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const steps = lines.filter((line) => /^\d+[.)]\s+/.test(line));
  const prose = lines.filter((line) => !/^\d+[.)]\s+/.test(line));
  return (
    <div className="training-narrative">
      {prose.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
      {steps.length > 0 && <ol>{steps.map((line, index) => {
        const content = line.replace(/^\d+[.)]\s+/, "");
        const [heading, ...rest] = content.split(":");
        return <li key={`${line}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{heading}</strong>{rest.length > 0 && <p>{rest.join(":").trim()}</p>}</div></li>;
      })}</ol>}
    </div>
  );
}

type AccessUser = Awaited<ReturnType<typeof api.listUsers>>[number];
type TrainingStats = Awaited<ReturnType<typeof api.trainingStats>>;

export function Training({ isAdmin = false }: { isAdmin?: boolean }) {
  const [question, setQuestion] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [answer, setAnswer] = useState<TrainingAnswer | null>(null);
  const [results, setResults] = useState<TrainingSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [thinkingStep, setThinkingStep] = useState("");
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([]);
  const [stats, setStats] = useState<TrainingStats | null>(null);

  async function loadAccessUsers() {
    if (isAdmin) {
      const [users, usage] = await Promise.all([api.listUsers(), api.trainingStats()]);
      setAccessUsers(users);
      setStats(usage);
    }
  }

  useEffect(() => {
    loadAccessUsers().catch((caught) => setError((caught as Error).message));
  }, [isAdmin]);

  async function toggleAccess(user: AccessUser) {
    await api.setTrainingAccess(user.id, !user.training_access);
    await loadAccessUsers();
  }

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    const value = question.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    setShareUrl("");
    setThinkingStep("Đang gửi câu hỏi tới Hermes");
    try {
      const searchPromise = api.trainingSearch(value).catch(() => ({ results: [] }));
      const job = await api.trainingJobStart(value, sessionId);
      setThinkingStep(job.stage);
      let status = await api.trainingJobStatus(job.jobId);
      while (status.status === "running") {
        setThinkingStep(status.stage);
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        status = await api.trainingJobStatus(job.jobId);
      }
      if (status.status === "failed" || !status.result) throw new Error(status.error || "Hermes chưa thể hoàn tất câu trả lời");
      const [chat, search] = await Promise.all([Promise.resolve(status.result), searchPromise]);
      setAnswer(chat.answer);
      setSessionId(chat.sessionId);
      setResults(search.results);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      setThinkingStep("");
    }
  }

  async function share() {
    if (!answer) return;
    try {
      const made = await api.trainingShare(question.trim(), answer);
      setShareUrl(made.url);
      if (navigator.share) await navigator.share({ title: question, text: answer.answer, url: made.url });
      else await navigator.clipboard.writeText(made.url);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function copyAnswer() {
    if (!answer) return;
    const sources = [...(answer.documentationEvidence || []), ...(answer.videoEvidence || [])]
      .map((item) => `- ${item.title}: ${item.url}`).join("\n");
    await navigator.clipboard.writeText(`${answer.answer}\n\n${answer.generalGuidance || ""}\n\nNguồn:\n${sources}`);
  }

  return (
    <div className="training-page">
      <header className="training-hero">
        <div><span>iNUT KNOWLEDGE DESK</span><h1>Hỏi kỹ thuật.<br />Gửi khách ngay.</h1></div>
        <p>Hermes tra đồng thời Help iNut PC, video thực hành và nội dung công khai trên iNut.vn. Không cần đăng nhập lần hai.</p>
      </header>

      <form className="training-prompt" onSubmit={ask}>
        <textarea aria-label="Câu hỏi cho iNut Training" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Khách đang hỏi gì? Ví dụ: cài frpc lỗi giờ sao..." maxLength={2000} />
        <div className="training-prompt-foot"><small>Giá và chính sách cần đối chiếu nguồn tại thời điểm trả lời.</small><button disabled={busy || !question.trim()}>{busy ? "Đang tra cứu…" : "Hỏi Hermes →"}</button></div>
      </form>

      {busy && <section className="training-thinking" role="status" aria-live="polite"><span className="training-thinking-pulse" /><div><strong>Hermes đang làm việc</strong><p>{thinkingStep}</p></div><small>Câu hỏi khó có thể cần đến 3 phút. Bạn có thể giữ nguyên trang này.</small></section>}

      <div className="training-quick">
        {QUICK_QUESTIONS.map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}</button>)}
      </div>
      {isAdmin && (
        <section className="training-access-panel">
          <div><span>PHÂN QUYỀN</span><h2>Tài khoản được dùng Training</h2><p>{accessUsers.filter((user) => user.training_access).length} tài khoản đang có quyền.</p></div>
          <button onClick={loadAccessUsers}>{accessUsers.length ? "Làm mới" : "Xem tài khoản"}</button>
          {accessUsers.length > 0 && <div className="training-access-list">{accessUsers.map((user) => (
            <label key={user.id}>
              <input type="checkbox" checked={user.training_access} disabled={user.role === "admin"} onChange={() => toggleAccess(user)} />
              <span><strong>{user.customer_name || user.username}</strong><small>{user.username} · {user.role}</small></span>
            </label>
          ))}</div>}
        </section>
      )}
      {isAdmin && stats && (
        <section className="training-stats">
          <div className="training-stat-head"><span>USAGE</span><h2>Nhịp sử dụng Training</h2><p>{stats.tokenNote}</p></div>
          <div className="training-stat-cards"><div><strong>{stats.totals.questions}</strong><span>Câu hỏi</span></div><div><strong>{stats.totals.tokens.toLocaleString("vi-VN")}</strong><span>Token ước tính</span></div><div><strong>{stats.totals.successful}</strong><span>Đã hoàn tất</span></div></div>
          <div className="training-user-chart">{stats.users.map((item) => {
            const maximum = Math.max(...stats.users.map((user) => user.questions), 1);
            return <div key={item.username}><label><strong>{item.username}</strong><small>{item.questions} câu · {item.tokens.toLocaleString("vi-VN")} token</small></label><span><i style={{ width: `${Math.max(7, item.questions / maximum * 100)}%` }} /></span></div>;
          })}</div>
          <div className="training-recent"><h3>Câu hỏi gần đây</h3>{stats.recent.map((item, index) => <article key={`${item.createdAt}-${index}`}><span>{item.username}</span><strong>{item.question}</strong><small>{item.status === "done" ? "Hoàn tất" : item.status === "failed" ? "Lỗi" : "Đang chạy"} · {item.tokens} token ước tính · {(item.durationMs / 1000).toFixed(1)} giây</small></article>)}</div>
        </section>
      )}
      {error && <div className="error">{error}</div>}

      {answer && (
        <div className="training-grid">
          <article className="training-answer">
            <div className="training-answer-head"><span>TRẢ LỜI CÓ NGUỒN</span><div><button onClick={copyAnswer}>Copy nội dung</button><button className="training-share" onClick={share}>Tạo link gửi khách</button></div></div>
            <NarrativeAnswer text={answer.answer} />
            {answer.generalGuidance && <section><h3>Hướng dẫn thêm</h3><p>{answer.generalGuidance}</p></section>}
            {!!answer.warnings?.length && <section className="training-warning"><h3>Lưu ý</h3><p>{answer.warnings.join("\n")}</p></section>}
            <EvidenceList title="Tài liệu iNut" items={answer.documentationEvidence} />
            <EvidenceList title="Video thực hành" items={answer.videoEvidence} />
            {shareUrl && <div className="training-shared"><strong>Đã tạo link:</strong><a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a></div>}
          </article>

          <aside className="training-results">
            <span>ĐỊNH VỊ NHANH</span><h2>{results.length} đoạn liên quan</h2>
            {results.map((item) => (
              <a href={item.citationUrl} target="_blank" rel="noreferrer" key={`${item.sourceId}-${item.timestamp || "doc"}`}>
                <b>{item.sourceType === "video" ? item.timestamp || "VIDEO" : item.sourceType.toUpperCase()}</b>
                <strong>{item.sourceTitle || item.videoTitle}</strong><small>{item.text}</small>
              </a>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
