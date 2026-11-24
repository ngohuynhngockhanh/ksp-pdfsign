import {
  AppButton,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  StepFlow,
} from "../../components/ui";
import type { GameState } from "./types";

interface ComplianceRoadmapTabProps {
  gameState: GameState | null;
  loading: boolean;
  activeQuestNote: Record<number, string>;
  onChangeNote: (questId: number, value: string) => void;
  onCompleteQuest: (questId: number) => void;
  onSaveNote: (questId: number) => void;
  onResetGame: () => void;
}

export function ComplianceRoadmapTab({
  gameState,
  loading,
  activeQuestNote,
  onChangeNote,
  onCompleteQuest,
  onSaveNote,
  onResetGame,
}: ComplianceRoadmapTabProps) {
  if (loading && !gameState) {
    return (
      <div className="ui-stack--lg">
        <KpiStrip loading items={[]} columns={4} />
        <SectionCard>
          <SkeletonBlock variant="title" />
          <SkeletonBlock variant="line" lines={3} />
        </SectionCard>
      </div>
    );
  }

  if (!gameState) {
    return (
      <EmptyState
        icon="clipboard-list"
        title="Chưa có dữ liệu lộ trình hợp quy"
        description="Hệ thống chưa tải được danh sách các mốc chứng nhận hợp quy cho thiết bị iNut."
      />
    );
  }

  const clampedPercent = Math.max(0, Math.min(100, gameState.progress_percent));

  return (
    <div className="ui-stack--lg">
      <KpiStrip
        columns={4}
        items={[
          {
            label: "Tiến độ hoàn thành",
            value: `${clampedPercent}%`,
            sub: `${gameState.completed_quests_count}/${gameState.total_quests} mốc hoàn tất`,
            icon: "target",
            tone: "brand",
          },
          {
            label: "Cấp độ hợp quy",
            value: `Lv.${gameState.current_level}`,
            sub: gameState.current_level_title || "Khởi động",
            icon: "award",
            tone: "gold",
          },
          {
            label: "Điểm tích lũy",
            value: `${gameState.current_exp}/${gameState.max_exp}`,
            sub: "EXP kiểm định",
            icon: "activity",
            tone: "info",
          },
          {
            label: "Trạng thái hồ sơ",
            value: clampedPercent >= 100 ? "Đạt CNHQ" : "Đang triển khai",
            sub: "Lộ trình 6 bước BTTTT",
            icon: "shield-check",
            tone: clampedPercent >= 100 ? "success" : "neutral",
          },
        ]}
      />

      <SectionCard
        title="Tiến độ lộ trình chứng nhận hợp quy"
        subtitle={`Giai đoạn hiện tại: ${gameState.current_level_title}`}
        icon="clipboard-check"
        actions={
          <AppButton variant="ghost" size="sm" leftIcon="rotate-ccw" onClick={onResetGame}>
            Đặt lại tiến độ
          </AppButton>
        }
      >
        <div className="ui-stack">
          <div className="ui-row-between">
            <span className="ui-text-strong ui-wrap">
              Hoàn thành {gameState.completed_quests_count} / {gameState.total_quests} bước kiểm định
            </span>
            <span className="ui-mono ui-wrap ui-muted">
              {gameState.current_exp} / {gameState.max_exp} EXP ({clampedPercent}%)
            </span>
          </div>

          <progress
            className="ui-progress"
            value={clampedPercent}
            max={100}
            aria-label="Tiến độ hoàn thành lộ trình hợp quy"
          />

          {gameState.quests.length > 0 && (
            <StepFlow
              ariaLabel="Các mốc trong lộ trình hợp quy"
              steps={gameState.quests.map((q) => ({
                id: String(q.quest_id),
                label: `Bước ${q.quest_id}`,
                done: q.status === "completed",
                active: q.status === "in_progress",
              }))}
            />
          )}

          {gameState.ai_companion_cheer && (
            <InlineAlert tone="info" title="Gợi ý trợ lý kỹ thuật">
              {gameState.ai_companion_cheer}
            </InlineAlert>
          )}
        </div>
      </SectionCard>

      {gameState.quests.length === 0 ? (
        <EmptyState
          icon="clipboard-check"
          title="Chưa có nhiệm vụ hợp quy nào"
          description="Danh sách các bước kiểm định sẽ xuất hiện tại đây khi backend cấu hình lộ trình."
          compact
        />
      ) : (
        <div className="ui-stack--lg">
          {gameState.quests.map((quest) => {
            const isCompleted = quest.status === "completed";
            const isInProgress = quest.status === "in_progress";
            const cardToneCls = isCompleted
              ? "std-card-done"
              : isInProgress
                ? "std-card-active"
                : "std-card-pending";
            const noteId = `quest-note-${quest.quest_id}`;
            const noteVal =
              activeQuestNote[quest.quest_id] !== undefined
                ? activeQuestNote[quest.quest_id]
                : quest.personal_note || "";

            return (
              <SectionCard
                key={quest.quest_id}
                className={cardToneCls}
                title={quest.title}
                subtitle={quest.subtitle}
                icon={isCompleted ? "check-circle" : isInProgress ? "target" : "clipboard-list"}
                actions={
                  <div className="ui-row">
                    <StatusBadge
                      tone={isCompleted ? "success" : isInProgress ? "brand" : "neutral"}
                      dot
                    >
                      Bước {quest.quest_id}:{" "}
                      {isCompleted
                        ? "Đã hoàn thành"
                        : isInProgress
                          ? "Đang thực hiện"
                          : "Chưa mở khóa"}
                    </StatusBadge>
                    <StatusBadge tone="warning" size="sm">
                      +{quest.exp_reward} EXP
                    </StatusBadge>
                    {isCompleted ? (
                      <StatusBadge tone="success" icon="award">
                        {quest.level_title}
                      </StatusBadge>
                    ) : (
                      <AppButton
                        variant={isInProgress ? "primary" : "secondary"}
                        size="sm"
                        leftIcon="check-circle"
                        onClick={() => onCompleteQuest(quest.quest_id)}
                      >
                        Hoàn thành bước (+{quest.exp_reward} EXP)
                      </AppButton>
                    )}
                  </div>
                }
              >
                <div className="ui-stack">
                  <div className="ui-subpanel ui-subpanel--md">
                    <strong>Nhiệm vụ chính:</strong> {quest.description}
                  </div>

                  <FormGrid cols={2}>
                    <InlineAlert tone="info" title="Lời khuyên kỹ thuật">
                      {quest.ai_companion_tip}
                    </InlineAlert>
                    <InlineAlert tone="warning" title="Lưu ý thực chiến">
                      {quest.secret_cheatsheet}
                    </InlineAlert>
                  </FormGrid>

                  <div className="ui-row ui-row--md ui-row--bottom">
                    <div className="ui-grow">
                      <FormField label="Ghi chú triển khai" htmlFor={noteId}>
                        <input
                          id={noteId}
                          type="text"
                          className="ui-input"
                          placeholder="Ngày gửi mẫu, mã vận đơn, mã Test Report, lưu ý phòng Lab..."
                          value={noteVal}
                          onChange={(e) => onChangeNote(quest.quest_id, e.target.value)}
                        />
                      </FormField>
                    </div>
                    <AppButton
                      variant="secondary"
                      size="md"
                      leftIcon="save"
                      onClick={() => onSaveNote(quest.quest_id)}
                    >
                      Lưu ghi chú
                    </AppButton>
                  </div>
                </div>
              </SectionCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
