import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

type MessengerStats = Awaited<ReturnType<typeof api.trainingStats>>["facebook"];
type MessengerConversation = Awaited<ReturnType<typeof api.facebookConversations>>["items"][number];
type MessengerHistory = Awaited<ReturnType<typeof api.facebookConversationHistory>>;
type StatusFilter = "all" | "processing" | "replied" | "rejected" | "failed";
type SortMode = "recent" | "messages" | "errors";

const STATUS_LABELS: Record<string, string> = {
  received: "Đã nhận",
  queued: "Đang chờ",
  processing: "Đang xử lý",
  replied: "Đã trả lời",
  sent: "Đã gửi",
  rejected: "Đã chặn",
  failed: "Lỗi",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status || "Chưa rõ";
}

function matchesStatus(status: string, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "processing") return status === "received" || status === "queued" || status === "processing";
  if (filter === "replied") return status === "replied" || status === "sent";
  return status === filter;
}

function errorMessage(error: string) {
  const value = error.trim();
  if (!value) return "Không có thông tin lỗi.";
  if (/Hermes Training khong tra loi duoc/i.test(value)) {
    return "Hermes chưa tạo được câu trả lời. Tin này đã dừng ở lần xử lý trước; hãy thử gửi lại sau khi kiểm tra kết nối iNut Training.";
  }
  if (/timeout|timed out|qua thoi gian cho/i.test(value)) {
    return "Dịch vụ phản hồi quá thời gian chờ. Tin này đã dừng, không còn chạy ngầm.";
  }
  if (/HTTP 400|tu choi yeu cau/i.test(value)) {
    return "iNut Training từ chối yêu cầu (HTTP 400). Tin này đã dừng; hãy thử gửi lại.";
  }
  if (/khong ket noi|loi ket noi/i.test(value)) {
    return "Không kết nối được iNut Training ở lần xử lý đó. Tin đã dừng và có thể thử lại.";
  }
  return value;
}

function duration(value: number) {
  if (!value || value < 1) return "—";
  return `${(value / 1000).toFixed(1)}s`;
}

function Metric({ value, label, warning = false }: { value: string | number; label: string; warning?: boolean }) {
  return <div className={warning ? "messenger-metric is-warning" : "messenger-metric"}><strong>{value}</strong><span>{label}</span></div>;
}

function stageMetric(stats: MessengerStats | null, key: "queue" | "hermes" | "context" | "send") {
  return stats ? duration(stats.stages[key]?.p95Ms || 0) : "—";
}

export function Messenger() {
  const [stats, setStats] = useState<MessengerStats | null>(null);
  const [conversations, setConversations] = useState<MessengerConversation[]>([]);
  const [selected, setSelected] = useState<MessengerHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortMode>("recent");

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi-VN");
    return [...conversations]
      .filter((conversation) => {
        const matchesSearch = !query || [conversation.name, conversation.lastText, conversation.pageId]
          .some((value) => value.toLocaleLowerCase("vi-VN").includes(query));
        return matchesSearch && matchesStatus(conversation.lastStatus, status);
      })
      .sort((left, right) => {
        if (sort === "messages") return right.messageCount - left.messageCount;
        if (sort === "errors") return right.failedCount - left.failedCount;
        return new Date(right.lastAt).getTime() - new Date(left.lastAt).getTime();
      });
  }, [conversations, search, sort, status]);

  async function load() {
    setBusy(true);
    setError("");
    const [usage, inbox] = await Promise.allSettled([api.trainingStats(), api.facebookConversations(100)]);
    if (usage.status === "fulfilled") setStats(usage.value.facebook);
    if (inbox.status === "fulfilled") setConversations(inbox.value.items);
    if (usage.status === "rejected" || inbox.status === "rejected") {
      setError("Chưa tải đủ dữ liệu Messenger. Hãy bấm Làm mới để thử lại.");
    }
    setBusy(false);
  }

  async function openConversation(conversation: MessengerConversation) {
    setBusy(true);
    setError("");
    try {
      setSelected(await api.facebookConversationHistory(conversation.pageId, conversation.psid));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="messenger-page">
      <header className="messenger-hero">
        <div>
          <span>FANPAGE OPERATIONS</span>
          <h1>Messenger fanpage</h1>
          <p>Quản lý hội thoại, xem lịch sử trả lời và khoanh vùng lỗi Hermes trong một màn hình riêng.</p>
        </div>
        <div className="messenger-hero-note"><strong>{conversations.length || 0}</strong><span>hội thoại đang hiển thị<br />tối đa 100 cuộc gần nhất</span></div>
      </header>

      <section className="messenger-overview" aria-labelledby="messenger-overview-title">
        <div className="messenger-overview-head"><div><span>HÔM NAY</span><h2 id="messenger-overview-title">Nhịp phản hồi của fanpage</h2></div><button type="button" onClick={load} disabled={busy}>{busy ? "Đang tải…" : "Làm mới dữ liệu"}</button></div>
        <div className="messenger-metrics" aria-label="Tổng quan Messenger">
          <Metric value={stats?.inbound ?? "—"} label="Tin vào" />
          <Metric value={stats?.outbound ?? "—"} label="Tin trả" />
          <Metric value={stats?.replied ?? "—"} label="Đã trả lời" />
          <Metric value={stats?.rejected ?? "—"} label="Bị chặn" />
          <Metric value={stats?.failed ?? "—"} label="Lỗi lịch sử" warning={Boolean(stats?.failed)} />
          <Metric value={stats ? duration(stats.latency.averageMs) : "—"} label="Trung bình" />
        </div>
        <div className="messenger-latency" aria-label="Độ trễ Messenger">
          <span>Độ trễ P95</span>
          <strong>Hàng đợi <b>{stageMetric(stats, "queue")}</b></strong>
          <strong>Hermes <b>{stageMetric(stats, "hermes")}</b></strong>
          <strong>Dựng ngữ cảnh <b>{stageMetric(stats, "context")}</b></strong>
          <strong>Gửi Graph <b>{stageMetric(stats, "send")}</b></strong>
        </div>
      </section>

      <section className="messenger-inbox" aria-labelledby="messenger-inbox-title">
        <div className="messenger-inbox-head"><div><span>INBOX</span><h2 id="messenger-inbox-title">Hội thoại gần đây</h2><p>Tìm theo tên, nội dung hoặc Page ID. Chọn một dòng để mở toàn bộ ngữ cảnh.</p></div><div className="messenger-inbox-count">{filtered.length}/{conversations.length} cuộc</div></div>
        <div className="messenger-toolbar">
          <label className="messenger-search"><span>Tìm hội thoại</span><input aria-label="Tìm hội thoại Messenger" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên, nội dung hoặc Page ID…" /></label>
          <label><span>Trạng thái</span><select aria-label="Lọc trạng thái Messenger" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">Tất cả</option><option value="processing">Đang xử lý</option><option value="replied">Đã trả lời</option><option value="rejected">Đã chặn</option><option value="failed">Lỗi</option></select></label>
          <label><span>Sắp xếp</span><select aria-label="Sắp xếp hội thoại Messenger" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="recent">Mới nhất</option><option value="messages">Nhiều tin nhất</option><option value="errors">Nhiều lỗi nhất</option></select></label>
        </div>
        {conversations.some((conversation) => conversation.failedCount > 0) && <div className="messenger-history-note"><strong>Lỗi lịch sử</strong><span>Các lỗi đã dừng ở lần xử lý trước, không có nghĩa Hermes đang chạy ngầm. Mở hội thoại để xem thời điểm và nguyên nhân.</span></div>}
        {conversations.length === 0 ? <p className="messenger-empty">Chưa có hội thoại Facebook. Khi fanpage nhận tin mới, hội thoại sẽ xuất hiện ở đây.</p> : filtered.length === 0 ? <p className="messenger-empty">Không có hội thoại khớp bộ lọc hiện tại.</p> : <div className="messenger-layout">
          <div className="training-facebook-list" aria-label="Danh sách hội thoại Messenger">{filtered.map((conversation) => <button type="button" key={conversation.conversationId} className={`training-facebook-row${selected?.psid === conversation.psid && selected?.pageId === conversation.pageId ? " active" : ""}`} onClick={() => openConversation(conversation)}>
            <span><strong>{conversation.name}</strong><small>{conversation.messageCount} tin · {new Date(conversation.lastAt).toLocaleString("vi-VN")}{conversation.lastLatencyMs > 0 ? ` · ${duration(conversation.lastLatencyMs)}` : ""}</small><em>{conversation.lastText}</em></span><b className={`messenger-status messenger-status-${conversation.lastStatus}`}>{statusLabel(conversation.lastStatus)}</b>{conversation.failedCount > 0 && <small className="messenger-history-badge">{conversation.failedCount} lỗi lịch sử</small>}
          </button>)}</div>
          {selected && <article className="training-facebook-detail"><header><div><span>{selected.pageId}</span><h3>{selected.name}</h3></div><small>{selected.items.length} tin nhắn · {selected.items.filter((item) => item.status === "failed").length} lỗi lịch sử</small></header><div className="training-facebook-thread">{selected.items.map((item) => <div key={item.id} className={`training-facebook-bubble ${item.direction === "inbound" ? "inbound" : "outbound"}`}><small>{item.direction === "inbound" ? selected.name : "iNut"} · {new Date(item.createdAt).toLocaleString("vi-VN")}{item.direction === "inbound" && item.latencyMs > 0 ? ` · trả lời ${duration(item.latencyMs)}` : ""}</small><p>{item.text}</p>{item.error && <div className="messenger-error"><strong>{statusLabel(item.status)} · lỗi đã dừng</strong><span>{errorMessage(item.error)}</span></div>}</div>)}</div></article>}
        </div>}
      </section>
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
