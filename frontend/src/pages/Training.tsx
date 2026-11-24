import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  DOC_TYPES,
  type DocRecord,
  type TrainingAnswer,
  type TrainingEvidence,
  type TrainingMode,
  type TrainingPublicLead,
  type TrainingPublicQuery,
  type TrainingSearchResult,
} from "../api";
import {
  AppButton,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  PageHeader,
  PageShell,
  SectionCard,
  SkeletonBlock,
  SplitWorkspace,
  StatusBadge,
  useConfirm,
  useToast,
  type SplitWorkspacePane,
  type StatusBadgeTone,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";

const QUICK_QUESTIONS = [
  "Cài FRPC lỗi giờ sao?",
  "iNut PC kết nối Modbus TCP thế nào?",
  "iNut Datalogger phù hợp cho bài toán nào?",
  "Giá iNut RS485 hiện tại bao nhiêu?",
];

const SALES_QUICK_QUESTIONS = [
  "Khách cần gateway RS485 cho 20 thiết bị, nên tư vấn gì?",
  "iNut Datalogger phù hợp trạm đo nào?",
  "Cho mình catalog sản phẩm iNut để gửi khách",
  "Khách hỏi giá iNut RS485 và bước tiếp theo",
];

const TRAINING_MODES: { id: TrainingMode; label: string; hint: string }[] = [
  {
    id: "technical",
    label: "Kỹ thuật / nguồn",
    hint: "Tra cứu tài liệu, video và hướng dẫn triển khai.",
  },
  {
    id: "sales",
    label: "Tư vấn bán hàng / Marketing",
    hint: "Định hướng nhu cầu, lợi ích và bước tiếp theo cho khách.",
  },
];

function leadStatusTone(status: string): StatusBadgeTone {
  if (status === "qualified") return "success";
  if (status === "in_progress") return "info";
  if (status === "new") return "brand";
  if (status === "spam") return "danger";
  return "neutral";
}

function EvidenceList({ title, items }: { title: string; items?: TrainingEvidence[] }) {
  if (!items?.length) return null;
  return (
    <div className="ui-stack--sm">
      <h3 className="ui-subhead">{title}</h3>
      {items.map((item, index) => {
        const href = safeHttpUrl(item.url);
        const badge =
          item.timestamp || title === "Video thực hành" ? item.timestamp || "VIDEO" : "TÀI LIỆU";
        if (!href) {
          return (
            <div
              className="ui-link-row ui-link-row--col is-disabled"
              aria-disabled="true"
              key={`${item.title}-${index}`}
            >
              <div>
                <StatusBadge tone="neutral" size="sm">
                  {badge}
                </StatusBadge>
              </div>
              <strong>{item.title}</strong>
              {item.quote && <small className="ui-muted">{item.quote}</small>}
            </div>
          );
        }
        return (
          <a
            className="ui-link-row ui-link-row--col"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            key={`${href}-${index}`}
          >
            <div>
              <StatusBadge tone={title === "Video thực hành" ? "info" : "brand"} size="sm">
                {badge}
              </StatusBadge>
            </div>
            <strong>{item.title}</strong>
            {item.quote && <small className="ui-muted">{item.quote}</small>}
          </a>
        );
      })}
    </div>
  );
}

function NarrativeAnswer({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const steps = lines.filter((line) => /^\d+[.)]\s+/.test(line));
  const prose = lines.filter((line) => !/^\d+[.)]\s+/.test(line));

  return (
    <div className="cm-narrative">
      {prose.map((line, index) => (
        <p key={`${line}-${index}`}>{line}</p>
      ))}
      {steps.length > 0 && (
        <ol className="ui-step-list">
          {steps.map((line, index) => {
            const content = line.replace(/^\d+[.)]\s+/, "");
            const [heading, ...rest] = content.split(":");
            return (
              <li key={`${line}-${index}`}>
                <span className="ui-step-badge">{String(index + 1).padStart(2, "0")}</span>
                <div className="ui-stack--sm">
                  <strong>{heading}</strong>
                  {rest.length > 0 && <p>{rest.join(":").trim()}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
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

export function Training({ isAdmin = false }: { isAdmin?: boolean }) {
  const toast = useToast();
  const confirmAction = useConfirm();
  const [question, setQuestion] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [mode, setMode] = useState<TrainingMode>("sales");
  const [answerMode, setAnswerMode] = useState<TrainingMode>("sales");
  const [answer, setAnswer] = useState<TrainingAnswer | null>(null);
  const [results, setResults] = useState<TrainingSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [thinkingStep, setThinkingStep] = useState("");
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([]);
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [history, setHistory] = useState<TrainingHistory>([]);
  const [knowledge, setKnowledge] = useState<TrainingKnowledge>([]);
  const [customerDocuments, setCustomerDocuments] = useState<DocRecord[]>([]);
  const [customerDocumentsLoading, setCustomerDocumentsLoading] = useState(false);
  const [knowledgeUserId, setKnowledgeUserId] = useState(0);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [publicLeads, setPublicLeads] = useState<TrainingPublicLead[]>([]);
  const [selectedLead, setSelectedLead] = useState<
    (TrainingPublicLead & { queries: TrainingPublicQuery[] }) | null
  >(null);
  const [leadNote, setLeadNote] = useState("");
  const [leadStatus, setLeadStatus] = useState("new");
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadPane, setLeadPane] = useState<SplitWorkspacePane>("primary");
  const quickQuestions = mode === "sales" ? SALES_QUICK_QUESTIONS : QUICK_QUESTIONS;

  async function loadAccessUsers(notify = false) {
    if (!isAdmin) return;
    const [users, usage, leads] = await Promise.allSettled([
      api.listUsers(),
      api.trainingStats(),
      api.trainingPublicLeads(),
    ]);
    if (users.status === "fulfilled" && Array.isArray(users.value)) setAccessUsers(users.value);
    if (usage.status === "fulfilled" && usage.value?.totals && usage.value?.runtime) {
      setStats(usage.value);
    }
    if (leads.status === "fulfilled") {
      setPublicLeads(
        Array.isArray(leads.value?.items)
          ? leads.value.items
          : Array.isArray(leads.value)
            ? (leads.value as unknown as TrainingPublicLead[])
            : [],
      );
    }
    const failed = [users, usage, leads].filter((result) => result.status === "rejected");
    if (failed.length) {
      const msg = "Một số dữ liệu quản trị chưa tải được. Hãy bấm Làm mới để thử lại.";
      setError(msg);
      if (notify) toast.error(msg);
    } else {
      setError("");
      if (notify) toast.success("Đã làm mới dữ liệu Training.");
    }
  }

  async function loadCustomerDocuments() {
    if (isAdmin) {
      setCustomerDocuments([]);
      return;
    }
    setCustomerDocumentsLoading(true);
    try {
      const docs = await api.myDocuments();
      setCustomerDocuments(Array.isArray(docs) ? docs : []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setCustomerDocumentsLoading(false);
    }
  }

  useEffect(() => {
    loadAccessUsers(false).catch((caught) => setError((caught as Error).message));
    loadCustomerDocuments().catch((caught) => setError((caught as Error).message));
    setHistoryLoading(true);
    Promise.all([api.trainingHistory(), api.trainingKnowledge()])
      .then(([past, notes]) => {
        setHistory(
          Array.isArray(past?.items)
            ? past.items
            : Array.isArray(past)
              ? (past as unknown as TrainingHistory)
              : [],
        );
        setKnowledge(
          Array.isArray(notes?.items)
            ? notes.items
            : Array.isArray(notes)
              ? (notes as unknown as TrainingKnowledge)
              : [],
        );
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setHistoryLoading(false));
  }, [isAdmin]);

  async function toggleAccess(user: AccessUser) {
    try {
      await api.setTrainingAccess(user.id, !user.training_access);
      toast.success(`Đã cập nhật quyền Training cho ${user.username}.`);
      await loadAccessUsers(false);
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    }
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
      const job = await api.trainingJobStart(value, sessionId, mode);
      setThinkingStep(job.stage);
      let status = await api.trainingJobStatus(job.jobId);
      while (status.status === "running") {
        setThinkingStep(status.stage);
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        status = await api.trainingJobStatus(job.jobId);
      }
      if (status.status === "failed" || !status.result) {
        throw new Error(status.error || "Hermes chưa thể hoàn tất câu trả lời");
      }
      const [chat, search] = await Promise.all([Promise.resolve(status.result), searchPromise]);
      setAnswer(chat.answer);
      setAnswerMode(mode);
      setSessionId(chat.sessionId);
      setResults(search.results);
      const past = await api.trainingHistory();
      setHistory(Array.isArray(past?.items) ? past.items : []);
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
      setThinkingStep("");
    }
  }

  async function addKnowledge(event: FormEvent) {
    event.preventDefault();
    if (!knowledgeUserId || !knowledgeTitle.trim() || !knowledgeContent.trim()) return;
    try {
      await api.createTrainingKnowledge(
        knowledgeUserId,
        knowledgeTitle.trim(),
        knowledgeContent.trim(),
      );
      setKnowledgeTitle("");
      setKnowledgeContent("");
      const notes = await api.trainingKnowledge(knowledgeUserId);
      setKnowledge(Array.isArray(notes?.items) ? notes.items : []);
      setError("");
      toast.success("Đã gán kiến thức riêng.");
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    }
  }

  async function removeKnowledge(id: number) {
    try {
      await api.deleteTrainingKnowledge(id);
      const notes = await api.trainingKnowledge(knowledgeUserId || undefined);
      setKnowledge(Array.isArray(notes?.items) ? notes.items : []);
      toast.success("Đã xóa ghi chú kiến thức.");
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    }
  }

  async function openPublicLead(lead: TrainingPublicLead, reveal = false) {
    setLeadBusy(true);
    try {
      const detail = await api.trainingPublicLead(lead.id, reveal);
      setSelectedLead(detail);
      setLeadNote(detail.note || "");
      setLeadStatus(detail.status);
      setLeadPane("secondary");
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLeadBusy(false);
    }
  }

  async function savePublicLead() {
    if (!selectedLead) return;
    setLeadBusy(true);
    try {
      await api.updateTrainingPublicLead(selectedLead.id, {
        status: leadStatus,
        note: leadNote,
      });
      const leads = await api.trainingPublicLeads();
      const items = Array.isArray(leads?.items) ? leads.items : [];
      setPublicLeads(items);
      await openPublicLead(items.find((item) => item.id === selectedLead.id) || selectedLead);
      toast.success("Đã lưu thay đổi lead.");
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLeadBusy(false);
    }
  }

  async function deletePublicLead() {
    if (!selectedLead) return;
    const accepted = await confirmAction({
      title: "Xóa lead công khai",
      message: "Xóa lead và toàn bộ lịch sử hội thoại này?",
      confirmLabel: "Xóa lead",
      tone: "danger",
    });
    if (!accepted) return;
    setLeadBusy(true);
    try {
      await api.deleteTrainingPublicLead(selectedLead.id);
      setSelectedLead(null);
      setLeadPane("primary");
      const leads = await api.trainingPublicLeads();
      setPublicLeads(Array.isArray(leads?.items) ? leads.items : []);
      toast.success("Đã xóa lead và lịch sử hội thoại.");
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLeadBusy(false);
    }
  }

  async function share() {
    if (!answer) return;
    try {
      const made = await api.trainingShare(question.trim(), answer);
      setShareUrl(made.url);
      if (navigator.share) {
        await navigator.share({ title: question, text: answer.answer, url: made.url });
      } else {
        await navigator.clipboard.writeText(made.url);
      }
      toast.success("Đã tạo link chia sẻ gửi khách.");
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    }
  }

  async function copyAnswer() {
    if (!answer) return;
    const sources = [...(answer.documentationEvidence || []), ...(answer.videoEvidence || [])]
      .map((item) => `- ${item.title}: ${item.url}`)
      .join("\n");
    await navigator.clipboard.writeText(
      `${answer.answer}\n\n${answer.generalGuidance || ""}\n\nNguồn:\n${sources}`,
    );
    toast.success("Đã sao chép nội dung trả lời.");
  }

  const safeShareHref = safeHttpUrl(shareUrl);

  return (
    <PageShell data-page="training">
      <PageHeader
        variant="compact"
        icon="book-open"
        eyebrow="iNUT KNOWLEDGE DESK"
        title="Hỏi kỹ thuật. Gửi khách ngay."
        subtitle="Hermes tra đồng thời Help iNut PC, video thực hành và nội dung công khai trên iNut.vn. Không cần đăng nhập lần hai."
      />

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <SectionCard
        eyebrow="MỤC TIÊU TRẢ LỜI"
        subtitle={TRAINING_MODES.find((item) => item.id === mode)?.hint}
        padding="compact"
        actions={
          <div className="ui-row" role="group" aria-label="Chọn chế độ Training">
            {TRAINING_MODES.map((item) => (
              <AppButton
                key={item.id}
                variant={mode === item.id ? "primary" : "secondary"}
                size="sm"
                aria-pressed={mode === item.id}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </AppButton>
            ))}
          </div>
        }
      >
        <div className="ui-stack">
          {mode === "sales" && (
            <InlineAlert tone="info" title="Marketing assistant an toàn">
              Chỉ dùng thông tin sản phẩm công khai và nguồn đã trích dẫn. Không hứa tồn kho, giao
              hàng, khuyến mãi hay báo giá nội bộ; khi cần cấu hình/custom, hãy chuyển nhân viên
              xác nhận.
            </InlineAlert>
          )}

          <form className="ui-stack" onSubmit={ask}>
            <textarea
              className="ui-textarea"
              aria-label="Câu hỏi cho iNut Training"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Khách đang hỏi gì? Ví dụ: cài frpc lỗi giờ sao..."
              maxLength={2000}
            />
            <div className="ui-row-between">
              <small className="ui-muted">
                Giá và chính sách cần đối chiếu nguồn tại thời điểm trả lời.
              </small>
              <AppButton
                type="submit"
                variant="primary"
                rightIcon="arrow-right"
                loading={busy}
                disabled={busy || !question.trim()}
              >
                {busy ? "Đang tra cứu…" : "Hỏi Hermes"}
              </AppButton>
            </div>
          </form>

          <div className="ui-row">
            {quickQuestions.map((item) => (
              <AppButton
                key={item}
                variant="secondary"
                size="sm"
                className="ui-wrap-btn"
                onClick={() => setQuestion(item)}
              >
                {item}
              </AppButton>
            ))}
          </div>

          <InlineAlert tone="warning" title="Lưu ý an toàn">
            Mọi câu hỏi và câu trả lời đều được lưu vào lịch sử. Quản trị viên KSP có thể kiểm tra
            khi phát hiện yêu cầu gọi tool, chạy lệnh hoặc truy cập trái phép.
          </InlineAlert>
        </div>
      </SectionCard>

      {busy && (
        <SectionCard tone="subtle" padding="compact">
          <div className="ui-stack--sm" role="status" aria-live="polite">
            <div className="ui-row">
              <span className="ui-status-dot ui-status-dot--brand is-pulse" aria-hidden="true" />
              <strong>Hermes đang làm việc</strong>
              <span className="ui-muted">{thinkingStep}</span>
            </div>
            <SkeletonBlock variant="line" lines={2} />
            <small className="ui-muted">
              Câu hỏi khó có thể cần đến 3 phút. Bạn có thể giữ nguyên trang này.
            </small>
          </div>
        </SectionCard>
      )}

      {answer && (
        <SplitWorkspace
          variant="preview-right"
          mobileTabs={["Câu trả lời", `Đoạn liên quan (${results.length})`]}
          primary={
            <SectionCard
              eyebrow={
                answerMode === "sales" ? "TƯ VẤN BÁN HÀNG CÓ NGUỒN" : "TRẢ LỜI CÓ NGUỒN"
              }
              title="Câu trả lời từ Hermes"
              icon="sparkles"
              actions={
                <div className="ui-row">
                  <AppButton variant="secondary" size="sm" leftIcon="copy" onClick={copyAnswer}>
                    Copy nội dung
                  </AppButton>
                  <AppButton variant="primary" size="sm" leftIcon="share" onClick={share}>
                    Tạo link gửi khách
                  </AppButton>
                </div>
              }
            >
              <div className="ui-stack">
                {answerMode === "sales" && (
                  <InlineAlert
                    tone="success"
                    title="Bước tiếp theo cho khách"
                    action={
                      <StatusBadge tone="brand" size="sm">
                        CTA đề xuất
                      </StatusBadge>
                    }
                  >
                    Gửi link trả lời có nguồn hoặc chuyển nhân viên iNut xác nhận cấu hình, giá và
                    yêu cầu tùy chỉnh.
                  </InlineAlert>
                )}

                <NarrativeAnswer text={answer.answer} />

                {answer.generalGuidance && (
                  <div className="ui-stack--sm">
                    <h3 className="ui-subhead">Hướng dẫn thêm</h3>
                    <p className="ui-muted">{answer.generalGuidance}</p>
                  </div>
                )}

                {!!answer.warnings?.length && (
                  <InlineAlert tone="warning" title="Lưu ý">
                    {answer.warnings.join("\n")}
                  </InlineAlert>
                )}

                <EvidenceList title="Tài liệu iNut" items={answer.documentationEvidence} />
                <EvidenceList title="Video thực hành" items={answer.videoEvidence} />

                {safeShareHref && (
                  <InlineAlert tone="success" title="Đã tạo link">
                    <a href={safeShareHref} target="_blank" rel="noopener noreferrer">
                      {shareUrl}
                    </a>
                  </InlineAlert>
                )}
              </div>
            </SectionCard>
          }
          secondary={
            <SectionCard
              eyebrow="ĐỊNH VỊ NHANH"
              title={`${results.length} đoạn liên quan`}
              icon="file-text"
              padding="compact"
            >
              {results.length === 0 ? (
                <EmptyState
                  icon="search"
                  title="Chưa có đoạn trích liên quan"
                  description="Thử đặt câu hỏi chi tiết hơn theo tên sản phẩm hoặc mã lỗi."
                  compact
                />
              ) : (
                <div className="ui-stack--sm">
                  {results.map((item) => {
                    const citeHref = safeHttpUrl(item.citationUrl);
                    const badge =
                      item.sourceType === "video"
                        ? item.timestamp || "VIDEO"
                        : item.sourceType.toUpperCase();
                    const key = `${item.sourceId}-${item.timestamp || "doc"}`;
                    if (!citeHref) {
                      return (
                        <div className="ui-link-row ui-link-row--col is-disabled" aria-disabled="true" key={key}>
                          <div>
                            <StatusBadge tone="neutral" size="sm">
                              {badge}
                            </StatusBadge>
                          </div>
                          <strong>{item.sourceTitle || item.videoTitle}</strong>
                          <small className="ui-muted">{item.text}</small>
                        </div>
                      );
                    }
                    return (
                      <a
                        className="ui-link-row ui-link-row--col"
                        href={citeHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        key={key}
                      >
                        <div>
                          <StatusBadge
                            tone={item.sourceType === "video" ? "info" : "brand"}
                            size="sm"
                          >
                            {badge}
                          </StatusBadge>
                        </div>
                        <strong>{item.sourceTitle || item.videoTitle}</strong>
                        <small className="ui-muted">{item.text}</small>
                      </a>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          }
        />
      )}

      {isAdmin && (
        <SectionCard
          eyebrow="PHÂN QUYỀN"
          title="Tài khoản được dùng Training"
          subtitle={`${accessUsers.filter((user) => user.training_access).length} tài khoản đang có quyền.`}
          icon="users"
          actions={
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="refresh"
              onClick={() => void loadAccessUsers(true)}
            >
              {accessUsers.length ? "Làm mới" : "Xem tài khoản"}
            </AppButton>
          }
        >
          {accessUsers.length === 0 ? (
            <EmptyState icon="users" title="Chưa tải danh sách tài khoản" compact />
          ) : (
            <FormGrid cols={3}>
              {accessUsers.map((user) => (
                <label className="ui-check-label" key={user.id}>
                  <input
                    type="checkbox"
                    checked={user.training_access}
                    disabled={user.role === "admin"}
                    onChange={() => void toggleAccess(user)}
                  />
                  <span className="ui-stack--xs ui-flex-1 cm-list-copy">
                    <strong>{user.customer_name || user.username}</strong>
                    <small>
                      {user.username} · {user.role}
                    </small>
                  </span>
                </label>
              ))}
            </FormGrid>
          )}
        </SectionCard>
      )}

      {isAdmin && accessUsers.length > 0 && (
        <SectionCard
          eyebrow="KIẾN THỨC RIÊNG"
          title="Training theo từng tài khoản"
          subtitle="Ghi chú chỉ được đưa vào ngữ cảnh của đúng người dùng và luôn bị coi là dữ liệu, không phải lệnh."
          icon="book-open"
        >
          <div className="ui-stack">
            <form className="ui-stack" onSubmit={addKnowledge}>
              <FormGrid cols={2}>
                <FormField label="Tài khoản nhận kiến thức" htmlFor="tr-kb-user">
                  <select
                    id="tr-kb-user"
                    className="ui-select"
                    aria-label="Tài khoản nhận kiến thức"
                    value={knowledgeUserId}
                    onChange={async (e) => {
                      const id = Number(e.target.value);
                      setKnowledgeUserId(id);
                      const notes = await api.trainingKnowledge(id || undefined);
                      setKnowledge(Array.isArray(notes?.items) ? notes.items : []);
                    }}
                  >
                    <option value={0}>Chọn tài khoản</option>
                    {accessUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Tiêu đề kiến thức" htmlFor="tr-kb-title">
                  <input
                    id="tr-kb-title"
                    className="ui-input"
                    aria-label="Tiêu đề kiến thức"
                    value={knowledgeTitle}
                    onChange={(e) => setKnowledgeTitle(e.target.value)}
                    maxLength={160}
                    placeholder="Ví dụ: Quy trình riêng của Bảo Toàn"
                  />
                </FormField>
              </FormGrid>

              <FormField label="Nội dung kiến thức" htmlFor="tr-kb-content">
                <textarea
                  id="tr-kb-content"
                  className="ui-textarea"
                  aria-label="Nội dung kiến thức"
                  rows={3}
                  value={knowledgeContent}
                  onChange={(e) => setKnowledgeContent(e.target.value)}
                  maxLength={12000}
                  placeholder="Dán ghi chú đã kiểm duyệt..."
                />
              </FormField>

              <div className="ui-row">
                <AppButton type="submit" variant="primary" size="sm" leftIcon="plus">
                  Gán kiến thức
                </AppButton>
              </div>
            </form>

            {knowledgeUserId > 0 &&
              (knowledge.length === 0 ? (
                <EmptyState icon="file-text" title="Chưa có ghi chú riêng cho tài khoản này" compact />
              ) : (
                <div className="ui-stack--sm">
                  {knowledge.map((note) => (
                    <div className="ui-link-row" key={note.id}>
                      <div className="ui-stack--xs ui-flex-1 cm-list-copy">
                        <strong>{note.title}</strong>
                        <small>{note.content}</small>
                      </div>
                      <AppButton
                        variant="danger"
                        size="sm"
                        leftIcon="trash"
                        onClick={() => void removeKnowledge(note.id)}
                      >
                        Xóa
                      </AppButton>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <SectionCard
          eyebrow="PUBLIC DESK"
          title="Lead từ trợ lý iNut.vn"
          subtitle="Số điện thoại được mã hóa; chỉ admin mới có thể chủ động mở số đầy đủ."
          icon="phone"
          actions={
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="refresh"
              onClick={() => void loadAccessUsers(true)}
            >
              Làm mới
            </AppButton>
          }
        >
          {publicLeads.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="Chưa có người để lại câu hỏi công khai."
              compact
            />
          ) : (
            <SplitWorkspace
              variant="inbox"
              mobileTabs={["Danh sách lead", "Chi tiết lead"]}
              activeMobilePane={leadPane}
              onMobilePaneChange={setLeadPane}
              primary={
                <div className="ui-chat-list">
                  {publicLeads.map((lead) => (
                    <AppButton
                      key={lead.id}
                      variant="ghost"
                      className={`ui-list-btn ui-list-btn--flex${selectedLead?.id === lead.id ? " is-active" : ""}`}
                      onClick={() => void openPublicLead(lead)}
                    >
                      <span className="ui-stack--xs ui-flex-1 cm-list-copy">
                        <strong>{lead.phone}</strong>
                        <small>
                          {lead.locale.toUpperCase()} · {lead.questionCount} câu ·{" "}
                          {new Date(lead.createdAt).toLocaleString("vi-VN")}
                        </small>
                      </span>
                      <StatusBadge tone={leadStatusTone(lead.status)} size="sm">
                        {lead.status}
                      </StatusBadge>
                    </AppButton>
                  ))}
                </div>
              }
              secondary={
                selectedLead ? (
                  <SectionCard
                    eyebrow={`LEAD #${selectedLead.id}`}
                    title={selectedLead.phone}
                    padding="compact"
                    actions={
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="eye"
                        disabled={leadBusy}
                        onClick={() => void openPublicLead(selectedLead, true)}
                      >
                        Mở số đầy đủ
                      </AppButton>
                    }
                  >
                    <div className="ui-stack">
                      <FormGrid cols={2}>
                        <FormField label="Trạng thái" htmlFor="tr-lead-status">
                          <select
                            id="tr-lead-status"
                            className="ui-select"
                            value={leadStatus}
                            onChange={(event) => setLeadStatus(event.target.value)}
                          >
                            <option value="new">Mới</option>
                            <option value="in_progress">Đang xử lý</option>
                            <option value="qualified">Đủ điều kiện</option>
                            <option value="closed">Đã đóng</option>
                            <option value="spam">Spam</option>
                          </select>
                        </FormField>
                        <FormField label="Ghi chú" htmlFor="tr-lead-note" fullWidth>
                          <textarea
                            id="tr-lead-note"
                            className="ui-textarea"
                            value={leadNote}
                            onChange={(event) => setLeadNote(event.target.value)}
                            maxLength={1000}
                            rows={3}
                          />
                        </FormField>
                      </FormGrid>

                      <div className="ui-row">
                        <AppButton
                          variant="primary"
                          size="sm"
                          leftIcon="save"
                          loading={leadBusy}
                          onClick={savePublicLead}
                        >
                          Lưu thay đổi
                        </AppButton>
                        <AppButton
                          variant="danger"
                          size="sm"
                          leftIcon="trash"
                          disabled={leadBusy}
                          onClick={deletePublicLead}
                        >
                          Xóa lead
                        </AppButton>
                      </div>

                      <div className="ui-chat-thread">
                        {selectedLead.queries.length === 0 ? (
                          <EmptyState icon="message-square" title="Chưa có transcript." compact />
                        ) : (
                          selectedLead.queries.map((query) => {
                            const publicAnswer = unwrapPublicAnswer(query.answer);
                            return (
                              <div className="ui-chat-bubble" key={query.jobId}>
                                <small className="ui-muted">
                                  {new Date(query.createdAt).toLocaleString("vi-VN")} ·{" "}
                                  {query.status}
                                </small>
                                <strong>{query.question}</strong>
                                {publicAnswer?.answer && <p>{publicAnswer.answer}</p>}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </SectionCard>
                ) : (
                  <SectionCard tone="subtle">
                    <EmptyState
                      icon="user"
                      title="Chọn một lead"
                      description="Nhấn vào lead ở danh sách bên trái để xem hội thoại và cập nhật ghi chú."
                      compact
                    />
                  </SectionCard>
                )
              }
            />
          )}
        </SectionCard>
      )}

      {!isAdmin && (
        <SectionCard
          eyebrow="TÀI LIỆU CỦA BẠN"
          title="Hồ sơ liên quan"
          subtitle="Tải nhanh các tài liệu INUT đã được chia sẻ cho tài khoản của bạn."
          icon="file-text"
        >
          {customerDocumentsLoading ? (
            <SkeletonBlock variant="line" lines={3} />
          ) : customerDocuments.length === 0 ? (
            <EmptyState
              icon="file-text"
              title="Chưa có tài liệu nào được chia sẻ cho tài khoản này."
              compact
            />
          ) : (
            <div className="ui-stack--sm">
              {customerDocuments.map((document) => {
                const docHref = safeHttpUrl(document.download_url);
                return docHref ? (
                  <a className="ui-link-row" href={docHref} key={document.id}>
                    <span className="ui-stack--xs ui-flex-1 cm-list-copy">
                      <strong>{document.filename}</strong>
                      <small>
                        {DOC_TYPES[document.doc_type] || document.doc_type || "Chưa phân loại"}
                      </small>
                    </span>
                    <div className="ui-row">
                      <time className="ui-muted" dateTime={document.created_at}>
                        {new Date(document.created_at).toLocaleDateString("vi-VN")}
                      </time>
                      <StatusBadge tone="brand" size="sm" icon="download">
                        Tải xuống
                      </StatusBadge>
                    </div>
                  </a>
                ) : (
                  <div className="ui-link-row is-disabled" key={document.id}>
                    <span className="ui-stack--xs ui-flex-1 cm-list-copy">
                      <strong>{document.filename}</strong>
                      <small>
                        {DOC_TYPES[document.doc_type] || document.doc_type || "Chưa phân loại"}
                      </small>
                    </span>
                    <time className="ui-muted" dateTime={document.created_at}>
                      {new Date(document.created_at).toLocaleDateString("vi-VN")}
                    </time>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard
        eyebrow="LỊCH SỬ CỦA BẠN"
        title="Mở lại câu hỏi đã hỏi"
        icon="clock"
      >
        {historyLoading ? (
          <SkeletonBlock variant="line" lines={3} />
        ) : history.length === 0 ? (
          <EmptyState icon="clock" title="Chưa có câu hỏi nào." compact />
        ) : (
          <div className="ui-chat-list">
            {history.map((item) => (
              <AppButton
                key={item.jobId}
                variant="ghost"
                className="ui-list-btn ui-list-btn--flex"
                onClick={() => {
                  setQuestion(item.question);
                  setAnswer(item.answer);
                  setAnswerMode("technical");
                  setResults([]);
                }}
              >
                <span className="ui-stack--xs ui-flex-1 cm-list-copy">
                  <strong>{item.question}</strong>
                  <small>{new Date(item.createdAt).toLocaleString("vi-VN")}</small>
                </span>
                <StatusBadge tone={item.status === "done" ? "success" : "neutral"} size="sm">
                  {item.status === "done" ? "Hoàn tất" : item.status}
                </StatusBadge>
              </AppButton>
            ))}
          </div>
        )}
      </SectionCard>

      {isAdmin && stats && (
        <SectionCard
          eyebrow="USAGE"
          title="Nhịp sử dụng Training"
          subtitle={stats.tokenNote}
          icon="bar-chart"
        >
          <div className="ui-stack">
            <KpiStrip
              columns={3}
              items={[
                { label: "Câu hỏi", value: stats.totals.questions, icon: "message-square", tone: "brand" },
                {
                  label: "Token ước tính",
                  value: stats.totals.tokens.toLocaleString("vi-VN"),
                  icon: "cpu",
                  tone: "info",
                },
                {
                  label: "Đã hoàn tất",
                  value: stats.totals.successful,
                  icon: "check-circle",
                  tone: "success",
                },
                {
                  label: `Nhịp trong ${stats.runtime.windowSeconds}s`,
                  value: `${stats.runtime.windowCount}/${stats.runtime.limit}`,
                  icon: "activity",
                  tone: "neutral",
                },
                { label: "Đang chạy", value: stats.runtime.active, icon: "zap", tone: "warning" },
                {
                  label: "Bị giới hạn",
                  value: stats.runtime.rejected,
                  icon: "ban",
                  tone: stats.runtime.rejected > 0 ? "danger" : "neutral",
                },
              ]}
            />

            {stats.users.length > 0 && (
              <div className="ui-stack--sm">
                {stats.users.map((item) => {
                  const maximum = Math.max(...stats.users.map((user) => user.questions), 1);
                  const pct = Math.max(7, (item.questions / maximum) * 100);
                  return (
                    <div className="ui-stack--sm" key={item.username}>
                      <div className="ui-row-between">
                        <strong>{item.username}</strong>
                        <small className="ui-muted">
                          {item.questions} câu · {item.tokens.toLocaleString("vi-VN")} token
                        </small>
                      </div>
                      <progress className="ui-progress" value={pct} max={100} />
                    </div>
                  );
                })}
              </div>
            )}

            {stats.recent.length > 0 && (
              <div className="ui-stack--sm">
                <h3 className="ui-subhead">Câu hỏi gần đây</h3>
                {stats.recent.map((item, index) => (
                  <div className="ui-link-row" key={`${item.createdAt}-${index}`}>
                    <div className="ui-stack--xs ui-flex-1 cm-list-copy">
                      <strong>{item.question}</strong>
                      <small>
                        {item.username} · {item.tokens} token ước tính ·{" "}
                        {(item.durationMs / 1000).toFixed(1)} giây
                      </small>
                    </div>
                    <StatusBadge
                      tone={
                        item.status === "done"
                          ? "success"
                          : item.status === "failed"
                            ? "danger"
                            : "info"
                      }
                      size="sm"
                    >
                      {item.status === "done"
                        ? "Hoàn tất"
                        : item.status === "failed"
                          ? "Lỗi"
                          : "Đang chạy"}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </PageShell>
  );
}
