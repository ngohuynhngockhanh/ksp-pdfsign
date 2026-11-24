import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  AppButton,
  EmptyState,
  FilterBar,
  InlineAlert,
  KpiStrip,
  PageHeader,
  PageShell,
  SectionCard,
  SkeletonBlock,
  SplitWorkspace,
  StatusBadge,
  useToast,
  type SplitWorkspacePane,
  type StatusBadgeTone,
} from "../components/ui";

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

function statusTone(status: string): StatusBadgeTone {
  if (status === "replied" || status === "sent") return "success";
  if (status === "processing" || status === "queued" || status === "received") return "info";
  if (status === "rejected") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function matchesStatus(status: string, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "processing") {
    return status === "received" || status === "queued" || status === "processing";
  }
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

function stageMetric(
  stats: MessengerStats | null,
  key: "queue" | "hermes" | "context" | "send",
) {
  return stats?.stages ? duration(stats.stages[key]?.p95Ms || 0) : "—";
}

export function Messenger() {
  const toast = useToast();
  const [stats, setStats] = useState<MessengerStats | null>(null);
  const [conversations, setConversations] = useState<MessengerConversation[]>([]);
  const [selected, setSelected] = useState<MessengerHistory | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [threadBusy, setThreadBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [mobilePane, setMobilePane] = useState<SplitWorkspacePane>("primary");

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi-VN");
    return [...conversations]
      .filter((conversation) => {
        const matchesSearch =
          !query ||
          [conversation.name, conversation.lastText, conversation.pageId].some((value) =>
            value.toLocaleLowerCase("vi-VN").includes(query),
          );
        return matchesSearch && matchesStatus(conversation.lastStatus, status);
      })
      .sort((left, right) => {
        if (sort === "messages") return right.messageCount - left.messageCount;
        if (sort === "errors") return right.failedCount - left.failedCount;
        return new Date(right.lastAt).getTime() - new Date(left.lastAt).getTime();
      });
  }, [conversations, search, sort, status]);

  async function load(notify = false) {
    setBusy(true);
    setError("");
    const [usage, inbox] = await Promise.allSettled([
      api.trainingStats(),
      api.facebookConversations(100),
    ]);
    if (usage.status === "fulfilled" && usage.value?.facebook) {
      setStats(usage.value.facebook);
    }
    if (inbox.status === "fulfilled") {
      const items = Array.isArray(inbox.value?.items)
        ? inbox.value.items
        : Array.isArray(inbox.value)
          ? (inbox.value as unknown as MessengerConversation[])
          : [];
      setConversations(items);
    }
    if (usage.status === "rejected" || inbox.status === "rejected") {
      const msg = "Chưa tải đủ dữ liệu Messenger. Hãy bấm Làm mới để thử lại.";
      setError(msg);
      if (notify) toast.error(msg);
    } else if (notify) {
      toast.success("Đã làm mới dữ liệu Messenger.");
    }
    setBusy(false);
    setInitialLoading(false);
  }

  async function openConversation(conversation: MessengerConversation) {
    setThreadBusy(true);
    setError("");
    try {
      const detail = await api.facebookConversationHistory(
        conversation.pageId,
        conversation.psid,
      );
      setSelected(detail);
      setMobilePane("secondary");
    } catch (caught) {
      const msg = (caught as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setThreadBusy(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, []);

  const activeFilters = (status !== "all" ? 1 : 0) + (sort !== "recent" ? 1 : 0);

  return (
    <PageShell data-page="messenger">
      <PageHeader
        variant="compact"
        icon="message-square"
        eyebrow="FANPAGE OPERATIONS"
        title="Messenger fanpage"
        subtitle="Quản lý hội thoại, xem lịch sử trả lời và khoanh vùng lỗi Hermes trong một màn hình riêng."
        actions={
          <>
            <StatusBadge tone="brand" size="sm">
              {conversations.length} / 100 hội thoại
            </StatusBadge>
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="refresh"
              loading={busy}
              onClick={() => void load(true)}
            >
              {busy ? "Đang tải…" : "Làm mới dữ liệu"}
            </AppButton>
          </>
        }
      />

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <SectionCard
        eyebrow="HÔM NAY"
        title="Nhịp phản hồi của fanpage"
        icon="activity"
        padding="compact"
      >
        <div className="ui-stack">
          <KpiStrip
            columns={3}
            loading={initialLoading}
            items={[
              { label: "Tin vào", value: stats?.inbound ?? "—", icon: "inbox", tone: "info" },
              { label: "Tin trả", value: stats?.outbound ?? "—", icon: "send", tone: "brand" },
              {
                label: "Đã trả lời",
                value: stats?.replied ?? "—",
                icon: "check-circle",
                tone: "success",
              },
              {
                label: "Bị chặn",
                value: stats?.rejected ?? "—",
                icon: "ban",
                tone: "warning",
              },
              {
                label: "Lỗi lịch sử",
                value: stats?.failed ?? "—",
                icon: "alert-triangle",
                tone: stats?.failed ? "danger" : "neutral",
              },
              {
                label: "Trung bình",
                value: stats?.latency ? duration(stats.latency.averageMs) : "—",
                icon: "clock",
                tone: "neutral",
              },
            ]}
          />

          <div className="cm-latency-bar" aria-label="Độ trễ Messenger">
            <StatusBadge tone="neutral" size="sm" icon="clock">
              Độ trễ P95
            </StatusBadge>
            <span>
              Hàng đợi <strong>{stageMetric(stats, "queue")}</strong>
            </span>
            <span>
              Hermes <strong>{stageMetric(stats, "hermes")}</strong>
            </span>
            <span>
              Dựng ngữ cảnh <strong>{stageMetric(stats, "context")}</strong>
            </span>
            <span>
              Gửi Graph <strong>{stageMetric(stats, "send")}</strong>
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="INBOX"
        title="Hội thoại gần đây"
        subtitle="Tìm theo tên, nội dung hoặc Page ID. Chọn một dòng để mở toàn bộ ngữ cảnh."
        icon="inbox"
        actions={
          <StatusBadge tone="neutral" size="sm">
            {filtered.length}/{conversations.length} cuộc
          </StatusBadge>
        }
      >
        <div className="ui-stack">
          <FilterBar
            collapsibleMobile={false}
            search={{
              value: search,
              onChange: setSearch,
              placeholder: "Tên, nội dung hoặc Page ID…",
              ariaLabel: "Tìm hội thoại Messenger",
            }}
            activeCount={activeFilters}
            onReset={() => {
              setSearch("");
              setStatus("all");
              setSort("recent");
            }}
            filters={
              <>
                <select
                  className="ui-select"
                  aria-label="Lọc trạng thái Messenger"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as StatusFilter)}
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="processing">Đang xử lý</option>
                  <option value="replied">Đã trả lời</option>
                  <option value="rejected">Đã chặn</option>
                  <option value="failed">Lỗi</option>
                </select>
                <select
                  className="ui-select"
                  aria-label="Sắp xếp hội thoại Messenger"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortMode)}
                >
                  <option value="recent">Mới nhất</option>
                  <option value="messages">Nhiều tin nhất</option>
                  <option value="errors">Nhiều lỗi nhất</option>
                </select>
              </>
            }
          />

          {conversations.some((conversation) => conversation.failedCount > 0) && (
            <InlineAlert tone="warning" title="Lỗi lịch sử">
              Các lỗi đã dừng ở lần xử lý trước, không có nghĩa Hermes đang chạy ngầm. Mở hội
              thoại để xem thời điểm và nguyên nhân.
            </InlineAlert>
          )}

          {initialLoading ? (
            <SkeletonBlock variant="line" lines={5} />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon="message-square"
              title="Chưa có hội thoại Facebook"
              description="Khi fanpage nhận tin mới, hội thoại sẽ xuất hiện ở đây."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="search"
              title="Không có hội thoại khớp bộ lọc hiện tại."
              description="Hãy điều chỉnh từ khóa tìm kiếm hoặc chọn trạng thái khác."
              compact
              action={
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="rotate-ccw"
                  onClick={() => {
                    setSearch("");
                    setStatus("all");
                  }}
                >
                  Xóa bộ lọc
                </AppButton>
              }
            />
          ) : (
            <SplitWorkspace
              variant="inbox"
              mobileTabs={["Danh sách hội thoại", "Chi tiết hội thoại"]}
              activeMobilePane={mobilePane}
              onMobilePaneChange={setMobilePane}
              primary={
                <div className="ui-chat-list" aria-label="Danh sách hội thoại Messenger">
                  {filtered.map((conversation) => {
                    const isActive =
                      selected?.psid === conversation.psid &&
                      selected?.pageId === conversation.pageId;
                    return (
                      <AppButton
                        key={conversation.conversationId}
                        variant="ghost"
                        className={`ui-list-btn ui-list-btn--flex${isActive ? " is-active" : ""}`}
                        onClick={() => void openConversation(conversation)}
                      >
                        <span className="ui-stack--xs ui-flex-1 cm-list-copy">
                          <strong>{conversation.name}</strong>
                          <small>
                            {conversation.messageCount} tin ·{" "}
                            {new Date(conversation.lastAt).toLocaleString("vi-VN")}
                            {conversation.lastLatencyMs > 0
                              ? ` · ${duration(conversation.lastLatencyMs)}`
                              : ""}
                          </small>
                          <em className="cm-list-preview">{conversation.lastText}</em>
                        </span>
                        <span className="cm-list-meta">
                          <StatusBadge tone={statusTone(conversation.lastStatus)} size="sm">
                            {statusLabel(conversation.lastStatus)}
                          </StatusBadge>
                          {conversation.failedCount > 0 && (
                            <StatusBadge tone="danger" size="sm">
                              {conversation.failedCount} lỗi lịch sử
                            </StatusBadge>
                          )}
                        </span>
                      </AppButton>
                    );
                  })}
                </div>
              }
              secondary={
                threadBusy ? (
                  <SectionCard padding="compact">
                    <SkeletonBlock variant="line" lines={5} />
                  </SectionCard>
                ) : selected ? (
                  <SectionCard
                    eyebrow={selected.pageId}
                    title={selected.name}
                    icon="message-square"
                    padding="compact"
                    actions={
                      <StatusBadge tone="neutral" size="sm">
                        {selected.items.length} tin nhắn ·{" "}
                        {selected.items.filter((item) => item.status === "failed").length} lỗi lịch
                        sử
                      </StatusBadge>
                    }
                  >
                    <div className="ui-chat-thread">
                      {selected.items.map((item) => (
                        <div
                          key={item.id}
                          className={`ui-chat-bubble${item.direction === "outbound" ? " ui-chat-bubble--out" : ""}`}
                        >
                          <small className="ui-muted">
                            {item.direction === "inbound" ? selected.name : "iNut"} ·{" "}
                            {new Date(item.createdAt).toLocaleString("vi-VN")}
                            {item.direction === "inbound" && item.latencyMs > 0
                              ? ` · trả lời ${duration(item.latencyMs)}`
                              : ""}
                          </small>
                          <p>{item.text}</p>
                          {item.error && (
                            <InlineAlert
                              tone="danger"
                              title={`${statusLabel(item.status)} · lỗi đã dừng`}
                            >
                              {errorMessage(item.error)}
                            </InlineAlert>
                          )}
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                ) : (
                  <SectionCard tone="subtle">
                    <EmptyState
                      icon="message-square"
                      title="Chọn một hội thoại"
                      description="Chọn một khách hàng ở danh sách bên trái để xem lịch sử tin nhắn và khoanh vùng lỗi Hermes."
                      compact
                    />
                  </SectionCard>
                )
              }
            />
          )}
        </div>
      </SectionCard>
    </PageShell>
  );
}
