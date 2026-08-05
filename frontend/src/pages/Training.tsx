import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, TrainingAnswer, TrainingEvidence, TrainingSearchResult, TrainingPublicLead, TrainingPublicQuery } from "../api";

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

function unwrapPublicAnswer(value: TrainingPublicQuery["answer"]): TrainingAnswer | null {
  let current: unknown = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const candidate = current as Record<string, unknown>;
    if (typeof candidate.answer === "string") return current as TrainingAnswer;
    if (!candidate.answer || typeof candidate.answer !== "object") return null;
    current = candidate.answer;
  }
  return null;
}

type AccessUser = Awaited<ReturnType<typeof api.listUsers>>[number];
type TrainingStats = Awaited<ReturnType<typeof api.trainingStats>>;
type TrainingHistory = Awaited<ReturnType<typeof api.trainingHistory>>["items"];
type TrainingKnowledge = Awaited<ReturnType<typeof api.trainingKnowledge>>["items"];
type FacebookConversation = Awaited<ReturnType<typeof api.facebookConversations>>["items"][number];
type FacebookHistory = Awaited<ReturnType<typeof api.facebookConversationHistory>>;

type FacebookStatusFilter = "all" | "processing" | "replied" | "rejected" | "failed";

const FACEBOOK_STATUS_LABELS: Record<string, string> = {
  received: "Đã nhận",
  queued: "Đang chờ",
  processing: "Đang xử lý",
  replied: "Đã trả lời",
  sent: "Đã gửi",
  rejected: "Đã chặn",
  failed: "Lỗi",
};

function facebookStatusLabel(status: string) {
  return FACEBOOK_STATUS_LABELS[status] || status || "Chưa rõ";
}

function facebookStatusFilterMatches(status: string, filter: FacebookStatusFilter) {
  if (filter === "all") return true;
  if (filter === "processing") return status === "received" || status === "queued" || status === "processing";
  if (filter === "replied") return status === "replied" || status === "sent";
  return status === filter;
}

function facebookErrorMessage(error: string) {
  const value = error.trim();
  if (!value) return "Không có thông tin lỗi.";
  if (/Hermes Training khong tra loi duoc/i.test(value)) {
    return "Hermes chưa tạo được câu trả lời. Tin này đã dừng ở lần xử lý trước; hãy thử gửi lại sau khi kiểm tra kết nối iNut Training.";
  }
  if (/timeout|timed out/i.test(value)) {
    return "Dịch vụ phản hồi quá thời gian chờ. Tin này đã dừng, không còn chạy ngầm.";
  }
  return value;
}

function formatDurationMs(value: number) {
  if (!value || value < 1) return "—";
  return `${(value / 1000).toFixed(1)}s`;
}

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
  const [history, setHistory] = useState<TrainingHistory>([]);
  const [knowledge, setKnowledge] = useState<TrainingKnowledge>([]);
  const [knowledgeUserId, setKnowledgeUserId] = useState(0);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [publicLeads, setPublicLeads] = useState<TrainingPublicLead[]>([]);
  const [facebookConversations, setFacebookConversations] = useState<FacebookConversation[]>([]);
  const [selectedFacebook, setSelectedFacebook] = useState<FacebookHistory | null>(null);
  const [facebookBusy, setFacebookBusy] = useState(false);
  const [facebookSearch, setFacebookSearch] = useState("");
  const [facebookStatusFilter, setFacebookStatusFilter] = useState<FacebookStatusFilter>("all");
  const [facebookSort, setFacebookSort] = useState<"recent" | "messages" | "errors">("recent");
  const [selectedLead, setSelectedLead] = useState<(TrainingPublicLead & { queries: TrainingPublicQuery[] }) | null>(null);
  const [leadNote, setLeadNote] = useState("");
  const [leadStatus, setLeadStatus] = useState("new");
  const [leadBusy, setLeadBusy] = useState(false);

  const filteredFacebookConversations = useMemo(() => {
    const query = facebookSearch.trim().toLocaleLowerCase("vi-VN");
    return [...facebookConversations]
      .filter((conversation) => {
        const matchesSearch = !query || [conversation.name, conversation.lastText, conversation.pageId]
          .some((value) => value.toLocaleLowerCase("vi-VN").includes(query));
        return matchesSearch && facebookStatusFilterMatches(conversation.lastStatus, facebookStatusFilter);
      })
      .sort((left, right) => {
        if (facebookSort === "messages") return right.messageCount - left.messageCount;
        if (facebookSort === "errors") return right.failedCount - left.failedCount;
        return new Date(right.lastAt).getTime() - new Date(left.lastAt).getTime();
      });
  }, [facebookConversations, facebookSearch, facebookSort, facebookStatusFilter]);

  async function loadAccessUsers() {
    if (isAdmin) {
      const [users, usage, leads, conversations] = await Promise.allSettled([
        api.listUsers(), api.trainingStats(), api.trainingPublicLeads(), api.facebookConversations(),
      ]);
      if (users.status === "fulfilled") setAccessUsers(users.value);
      if (usage.status === "fulfilled") setStats(usage.value);
      if (leads.status === "fulfilled") setPublicLeads(leads.value.items);
      if (conversations.status === "fulfilled") setFacebookConversations(conversations.value.items);
      const failed = [users, usage, leads, conversations].filter((result) => result.status === "rejected");
      setError(failed.length ? "Một số dữ liệu quản trị chưa tải được. Hãy bấm Làm mới inbox để thử lại." : "");
    }
  }

  useEffect(() => {
    loadAccessUsers().catch((caught) => setError((caught as Error).message));
    Promise.all([api.trainingHistory(), api.trainingKnowledge()]).then(([past, notes]) => {
      setHistory(past.items); setKnowledge(notes.items);
    }).catch((caught) => setError((caught as Error).message));
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
      const past = await api.trainingHistory();
      setHistory(past.items);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      setThinkingStep("");
    }
  }

  async function addKnowledge(event: FormEvent) {
    event.preventDefault();
    if (!knowledgeUserId || !knowledgeTitle.trim() || !knowledgeContent.trim()) return;
    await api.createTrainingKnowledge(knowledgeUserId, knowledgeTitle.trim(), knowledgeContent.trim());
    setKnowledgeTitle(""); setKnowledgeContent("");
    const notes = await api.trainingKnowledge(knowledgeUserId);
    setKnowledge(notes.items);
    setError("");
  }

  async function removeKnowledge(id: number) {
    await api.deleteTrainingKnowledge(id);
    const notes = await api.trainingKnowledge(knowledgeUserId || undefined);
    setKnowledge(notes.items);
  }

  async function openPublicLead(lead: TrainingPublicLead, reveal = false) {
    setLeadBusy(true);
    try {
      const detail = await api.trainingPublicLead(lead.id, reveal);
      setSelectedLead(detail);
      setLeadNote(detail.note || "");
      setLeadStatus(detail.status);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLeadBusy(false);
    }
  }

  async function openFacebookConversation(conversation: FacebookConversation) {
    setFacebookBusy(true);
    try {
      setSelectedFacebook(await api.facebookConversationHistory(conversation.pageId, conversation.psid));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setFacebookBusy(false);
    }
  }

  async function savePublicLead() {
    if (!selectedLead) return;
    setLeadBusy(true);
    try {
      await api.updateTrainingPublicLead(selectedLead.id, { status: leadStatus, note: leadNote });
      const leads = await api.trainingPublicLeads();
      setPublicLeads(leads.items);
      await openPublicLead(leads.items.find((item) => item.id === selectedLead.id) || selectedLead);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLeadBusy(false);
    }
  }

  async function deletePublicLead() {
    if (!selectedLead || !window.confirm("Xóa lead và toàn bộ lịch sử hội thoại này?")) return;
    setLeadBusy(true);
    try {
      await api.deleteTrainingPublicLead(selectedLead.id);
      setSelectedLead(null);
      const leads = await api.trainingPublicLeads();
      setPublicLeads(leads.items);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLeadBusy(false);
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
      <div className="training-audit-notice"><strong>Lưu ý an toàn</strong><span>Mọi câu hỏi và câu trả lời đều được lưu vào lịch sử. Quản trị viên KSP có thể kiểm tra khi phát hiện yêu cầu gọi tool, chạy lệnh hoặc truy cập trái phép.</span></div>

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
      {isAdmin && accessUsers.length > 0 && <section className="training-knowledge-admin">
        <div><span>KIẾN THỨC RIÊNG</span><h2>Training theo từng tài khoản</h2><p>Ghi chú chỉ được đưa vào ngữ cảnh của đúng người dùng và luôn bị coi là dữ liệu, không phải lệnh.</p></div>
        <form onSubmit={addKnowledge}><select aria-label="Tài khoản nhận kiến thức" value={knowledgeUserId} onChange={async (e) => { const id = Number(e.target.value); setKnowledgeUserId(id); const notes = await api.trainingKnowledge(id || undefined); setKnowledge(notes.items); }}><option value={0}>Chọn tài khoản</option>{accessUsers.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}</select><input aria-label="Tiêu đề kiến thức" value={knowledgeTitle} onChange={(e) => setKnowledgeTitle(e.target.value)} maxLength={160} placeholder="Ví dụ: Quy trình riêng của Bảo Toàn" /><textarea aria-label="Nội dung kiến thức" value={knowledgeContent} onChange={(e) => setKnowledgeContent(e.target.value)} maxLength={12000} placeholder="Dán ghi chú đã kiểm duyệt..." /><button>Gán kiến thức</button></form>
        {knowledgeUserId > 0 && <div className="training-knowledge-list">{knowledge.map((note) => <article key={note.id}><div><strong>{note.title}</strong><p>{note.content}</p></div><button onClick={() => removeKnowledge(note.id)}>Xóa</button></article>)}</div>}
      </section>}
      {isAdmin && <section className="training-public-leads">
        <div className="training-public-leads-head"><div><span>PUBLIC DESK</span><h2>Lead từ trợ lý iNut.vn</h2><p>Số điện thoại được mã hóa; chỉ admin mới có thể chủ động mở số đầy đủ.</p></div><button type="button" onClick={loadAccessUsers}>Làm mới</button></div>
        {publicLeads.length === 0 ? <p className="training-public-empty">Chưa có người để lại câu hỏi công khai.</p> : <div className="training-public-leads-layout"><div className="training-public-lead-list">{publicLeads.map((lead) => <button type="button" key={lead.id} className={`training-public-lead-row${selectedLead?.id === lead.id ? " active" : ""}`} onClick={() => openPublicLead(lead)}><span><strong>{lead.phone}</strong><small>{lead.locale.toUpperCase()} · {lead.questionCount} câu · {new Date(lead.createdAt).toLocaleString("vi-VN")}</small></span><b>{lead.status}</b></button>)}</div>{selectedLead && <article className="training-public-lead-detail"><div className="training-public-detail-head"><div><span>LEAD #{selectedLead.id}</span><h3>{selectedLead.phone}</h3></div><button type="button" onClick={() => openPublicLead(selectedLead, true)} disabled={leadBusy}>Mở số đầy đủ</button></div><div className="training-public-controls"><label>Trạng thái<select value={leadStatus} onChange={(event) => setLeadStatus(event.target.value)}><option value="new">Mới</option><option value="in_progress">Đang xử lý</option><option value="qualified">Đủ điều kiện</option><option value="closed">Đã đóng</option><option value="spam">Spam</option></select></label><label>Ghi chú<textarea value={leadNote} onChange={(event) => setLeadNote(event.target.value)} maxLength={1000} rows={3} /></label><div><button type="button" onClick={savePublicLead} disabled={leadBusy}>Lưu thay đổi</button><button type="button" className="danger" onClick={deletePublicLead} disabled={leadBusy}>Xóa lead</button></div></div><div className="training-public-transcript">{selectedLead.queries.length === 0 ? <p>Chưa có transcript.</p> : selectedLead.queries.map((query) => { const publicAnswer = unwrapPublicAnswer(query.answer); return <article key={query.jobId}><small>{new Date(query.createdAt).toLocaleString("vi-VN")} · {query.status}</small><strong>{query.question}</strong>{publicAnswer?.answer && <p>{publicAnswer.answer}</p>}</article>; })}</div></article>}</div>}
      </section>}
      {isAdmin && <section className="messenger-console" aria-labelledby="messenger-console-title">
        <div className="messenger-console-head">
          <div><span>QUẢN TRỊ MESSENGER</span><h2 id="messenger-console-title">Inbox fanpage iNut</h2><p>Hội thoại Facebook nằm riêng khỏi Training. Tìm tên, đọc đủ ngữ cảnh và nhận biết ngay lỗi đang xử lý hay lỗi lịch sử.</p></div>
          <button type="button" onClick={loadAccessUsers} disabled={facebookBusy}>{facebookBusy ? "Đang tải…" : "Làm mới inbox"}</button>
        </div>
        {stats && <div className="messenger-kpis" aria-label="Tổng quan Messenger">
          <div><strong>{stats.facebook.inbound}</strong><span>Tin khách gửi</span></div>
          <div><strong>{stats.facebook.replied}</strong><span>Đã trả lời</span></div>
          <div><strong>{stats.facebook.rejected}</strong><span>Đã chặn</span></div>
          <div className={stats.facebook.failed > 0 ? "is-warning" : ""}><strong>{stats.facebook.failed}</strong><span>Lỗi lịch sử</span></div>
          <div><strong>{formatDurationMs(stats.facebook.latency.averageMs)}</strong><span>Phản hồi trung bình</span></div>
        </div>}
        <div className="messenger-toolbar">
          <label className="messenger-search"><span>Tìm hội thoại</span><input aria-label="Tìm hội thoại Messenger" value={facebookSearch} onChange={(event) => setFacebookSearch(event.target.value)} placeholder="Tên, nội dung hoặc Page ID…" /></label>
          <label><span>Trạng thái</span><select aria-label="Lọc trạng thái Messenger" value={facebookStatusFilter} onChange={(event) => setFacebookStatusFilter(event.target.value as FacebookStatusFilter)}><option value="all">Tất cả</option><option value="processing">Đang xử lý</option><option value="replied">Đã trả lời</option><option value="rejected">Đã chặn</option><option value="failed">Lỗi</option></select></label>
          <label><span>Sắp xếp</span><select aria-label="Sắp xếp hội thoại Messenger" value={facebookSort} onChange={(event) => setFacebookSort(event.target.value as typeof facebookSort)}><option value="recent">Mới nhất</option><option value="messages">Nhiều tin nhất</option><option value="errors">Nhiều lỗi nhất</option></select></label>
        </div>
        {facebookConversations.some((conversation) => conversation.failedCount > 0) && <div className="messenger-history-note"><strong>Lỗi lịch sử</strong><span>Một số hội thoại có lỗi từ lần chạy trước. Lỗi đã dừng, không có nghĩa Hermes đang tiếp tục xử lý; mở hội thoại để xem thời điểm và nguyên nhân.</span></div>}
        {facebookConversations.length === 0 ? <p className="messenger-empty">Chưa có hội thoại Facebook. Khi fanpage nhận tin mới, hội thoại sẽ xuất hiện ở đây.</p> : filteredFacebookConversations.length === 0 ? <p className="messenger-empty">Không có hội thoại khớp bộ lọc hiện tại.</p> : <div className="training-facebook-layout">
          <div className="training-facebook-list" aria-label="Danh sách hội thoại Messenger">{filteredFacebookConversations.map((conversation) => <button type="button" key={conversation.conversationId} className={`training-facebook-row${selectedFacebook?.psid === conversation.psid && selectedFacebook?.pageId === conversation.pageId ? " active" : ""}`} onClick={() => openFacebookConversation(conversation)}>
            <span><strong>{conversation.name}</strong><small>{conversation.messageCount} tin · {new Date(conversation.lastAt).toLocaleString("vi-VN")}{conversation.lastLatencyMs > 0 ? ` · ${formatDurationMs(conversation.lastLatencyMs)}` : ""}</small><em>{conversation.lastText}</em></span><b className={`messenger-status messenger-status-${conversation.lastStatus}`}>{facebookStatusLabel(conversation.lastStatus)}</b>{conversation.failedCount > 0 && <small className="messenger-history-badge">{conversation.failedCount} lỗi lịch sử</small>}
          </button>)}</div>
          {selectedFacebook && <article className="training-facebook-detail"><header><div><span>{selectedFacebook.pageId}</span><h3>{selectedFacebook.name}</h3></div><small>{selectedFacebook.items.length} tin nhắn · {selectedFacebook.items.filter((item) => item.status === "failed").length} lỗi lịch sử</small></header><div className="training-facebook-thread">{selectedFacebook.items.map((item) => <div key={item.id} className={`training-facebook-bubble ${item.direction === "inbound" ? "inbound" : "outbound"}`}><small>{item.direction === "inbound" ? selectedFacebook.name : "iNut"} · {new Date(item.createdAt).toLocaleString("vi-VN")}{item.direction === "inbound" && item.latencyMs > 0 ? ` · trả lời ${formatDurationMs(item.latencyMs)}` : ""}</small><p>{item.text}</p>{item.error && <div className="messenger-error"><strong>{facebookStatusLabel(item.status)} · lỗi đã dừng</strong><span>{facebookErrorMessage(item.error)}</span></div>}</div>)}</div></article>}
        </div>}
      </section>}
      <section className="training-history"><div><span>LỊCH SỬ CỦA BẠN</span><h2>Mở lại câu hỏi đã hỏi</h2></div>{history.length === 0 ? <p>Chưa có câu hỏi nào.</p> : <div>{history.map((item) => <button key={item.jobId} onClick={() => { setQuestion(item.question); setAnswer(item.answer); setResults([]); }}><strong>{item.question}</strong><small>{new Date(item.createdAt).toLocaleString("vi-VN")} · {item.status === "done" ? "Hoàn tất" : item.status}</small></button>)}</div>}</section>
      {isAdmin && stats && (
        <section className="training-stats">
          <div className="training-stat-head"><span>USAGE</span><h2>Nhịp sử dụng Training</h2><p>{stats.tokenNote}</p></div>
          <div className="training-stat-cards"><div><strong>{stats.totals.questions}</strong><span>Câu hỏi</span></div><div><strong>{stats.totals.tokens.toLocaleString("vi-VN")}</strong><span>Token ước tính</span></div><div><strong>{stats.totals.successful}</strong><span>Đã hoàn tất</span></div><div><strong>{stats.runtime.windowCount}/{stats.runtime.limit}</strong><span>Nhịp trong {stats.runtime.windowSeconds}s</span></div><div><strong>{stats.runtime.active}</strong><span>Đang chạy</span></div><div><strong>{stats.runtime.rejected}</strong><span>Bị giới hạn</span></div></div>
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
