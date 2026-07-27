import { FormEvent, useState } from "react";
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

export function Training() {
  const [question, setQuestion] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [answer, setAnswer] = useState<TrainingAnswer | null>(null);
  const [results, setResults] = useState<TrainingSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    const value = question.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    setShareUrl("");
    try {
      const [chat, search] = await Promise.all([
        api.trainingAsk(value, sessionId),
        api.trainingSearch(value).catch(() => ({ results: [] })),
      ]);
      setAnswer(chat.answer);
      setSessionId(chat.sessionId);
      setResults(search.results);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
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

      <div className="training-quick">
        {QUICK_QUESTIONS.map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}</button>)}
      </div>
      {error && <div className="error">{error}</div>}

      {answer && (
        <div className="training-grid">
          <article className="training-answer">
            <div className="training-answer-head"><span>TRẢ LỜI CÓ NGUỒN</span><div><button onClick={copyAnswer}>Copy nội dung</button><button className="training-share" onClick={share}>Tạo link gửi khách</button></div></div>
            <p className="training-main-answer">{answer.answer}</p>
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
