"use client";

import type { AiCommand } from "@/lib/ai/command-schema";
import type {
  BlackoutChange,
  BlackoutPreview,
  CommandResult,
  TaskChange,
  TaskPreview,
} from "@/lib/commands/types";

type CommandPreviewCardProps = {
  command: AiCommand;
  index: number;
  result?: CommandResult;
};

type CommandMeta = {
  label: string;
  accent: string;
  toneClass: string;
};

const commandMeta = (type: AiCommand["type"]): CommandMeta => {
  switch (type) {
    case "create_tasks":
      return { label: "Create tasks", accent: "bg-primary/15 text-primary", toneClass: "border-primary/40" };
    case "log_completion":
      return { label: "Log completion", accent: "bg-success/15 text-success", toneClass: "border-success/40" };
    case "shrink_task":
      return { label: "Shrink task", accent: "bg-accent/20 text-accent-foreground", toneClass: "border-accent/50" };
    case "add_blackout":
      return { label: "Add blackout", accent: "bg-foreground/10 text-foreground", toneClass: "border-foreground/40" };
    case "update_blackout_window":
      return { label: "Update blackout", accent: "bg-foreground/10 text-foreground", toneClass: "border-foreground/40" };
    case "delete_blackout_window":
      return { label: "Delete blackout", accent: "bg-foreground/10 text-foreground", toneClass: "border-foreground/40" };
    case "add_urgent_task":
      return { label: "Add urgent task", accent: "bg-danger/15 text-danger", toneClass: "border-danger/40" };
    case "update_task_fields":
      return { label: "Update task", accent: "bg-primary/15 text-primary", toneClass: "border-primary/50" };
    case "reschedule_task":
      return { label: "Reschedule", accent: "bg-accent/15 text-accent-foreground", toneClass: "border-accent/40" };
    case "reprioritize_task":
      return { label: "Reprioritize", accent: "bg-accent/15 text-accent-foreground", toneClass: "border-accent/50" };
    case "pause_task":
    case "resume_task":
      return { label: "Pause/Resume", accent: "bg-muted text-foreground", toneClass: "border-muted/60" };
    case "delete_task":
    case "restore_task":
      return { label: "Delete/Restore", accent: "bg-muted text-foreground", toneClass: "border-muted/60" };
    case "split_task":
      return { label: "Split task", accent: "bg-primary/15 text-primary", toneClass: "border-primary/40" };
    case "merge_tasks":
      return { label: "Merge tasks", accent: "bg-primary/15 text-primary", toneClass: "border-primary/40" };
    case "mark_task_done":
      return { label: "Mark done", accent: "bg-success/15 text-success", toneClass: "border-success/40" };
    case "reopen_task":
      return { label: "Reopen task", accent: "bg-primary/15 text-primary", toneClass: "border-primary/40" };
    default:
      return { label: type, accent: "bg-muted text-foreground", toneClass: "border-border/70" };
  }
};

const priorityText = (priority: number | undefined): string => {
  if (priority === undefined) return "未设置优先级";
  if (priority >= 10) return "紧急 (10)";
  if (priority >= 3) return `高 (${priority})`;
  if (priority === 2) return "中 (2)";
  return `普通 (${priority})`;
};

const minutesText = (value?: number | null): string => {
  if (value === null || value === undefined) return "未提供";
  if (!Number.isFinite(value)) return "未提供";
  return `${value} 分钟`;
};

const dateText = (value?: string | null): string => {
  if (value === undefined) return "未提供";
  if (value === null) return "清空";
  return value.slice(0, 10);
};

const statusText = (status: TaskPreview["status"]): string => {
  switch (status) {
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "archived":
      return "archived";
    default:
      return status;
  }
};

const blackoutRangeText = (start: string, end: string): string => `${start.slice(0, 10)} → ${end.slice(0, 10)}`;

const renderMatchedBlackouts = (blackouts?: BlackoutPreview[]) => {
  if (!blackouts || blackouts.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">匹配到的 blackout</div>
      <div className="space-y-1.5">
        {blackouts.map((window) => (
          <div key={window.id} className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{blackoutRangeText(window.start, window.end)}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {window.id}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">原因：{window.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const renderMatchedTasks = (tasks?: TaskPreview[]) => {
  if (!tasks || tasks.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">匹配到的任务</div>
      <div className="space-y-1.5">
        {tasks.map((task) => (
          <div key={task.id} className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{task.title}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {task.id}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <span>状态 {statusText(task.status)}</span>
              <span>剩余 {minutesText(task.remainingMinutes)}</span>
              <span>截止 {dateText(task.dueDate ?? undefined)}</span>
              <span>优先级 {priorityText(task.priority)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const changedFields = (change: TaskChange): Array<{ field: string; before: string; after: string }> => {
  const fields: Array<keyof TaskPreview> = [
    "title",
    "status",
    "estimateMinutes",
    "remainingMinutes",
    "dueDate",
    "priority",
    "note",
  ];

  return fields
    .map((field) => {
      const beforeVal = change.before[field];
      const afterVal = change.after[field];
      if (beforeVal === afterVal) return null;

      const format = (value: unknown) => {
        if (field === "priority") return priorityText(value as number | undefined);
        if (field === "dueDate") return dateText(value as string | null | undefined);
        if (field === "status") return statusText(value as TaskPreview["status"]);
        if (field === "remainingMinutes" || field === "estimateMinutes") return minutesText(value as number | undefined);
        return (value ?? "未提供") as string;
      };

      return { field: String(field), before: format(beforeVal), after: format(afterVal) };
    })
    .filter(Boolean) as Array<{ field: string; before: string; after: string }>;
};

const renderBlackoutChanges = (changes?: BlackoutChange[]) => {
  if (!changes || changes.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">变更前 → 变更后</div>
      <div className="space-y-1.5">
        {changes.map((change, idx) => {
          const afterRange = change.after ? blackoutRangeText(change.after.start, change.after.end) : "删除";
          const afterReason = change.after ? change.after.reason : "删除";

          return (
            <div key={idx} className="flex flex-col gap-1 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <div>日期 {blackoutRangeText(change.before.start, change.before.end)} → {afterRange}</div>
              <div>原因 {change.before.reason} → {afterReason}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const renderChanges = (changes?: TaskChange[]) => {
  if (!changes || changes.length === 0) return null;

  const diff = changes.flatMap(changedFields);
  if (diff.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">变更前 → 变更后</div>
      <div className="space-y-1.5">
        {diff.map((item) => (
          <div key={`${item.field}-${item.before}-${item.after}`} className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
            <span className="min-w-[92px] font-semibold text-foreground">{item.field}</span>
            <div className="flex flex-1 flex-col gap-1 text-muted-foreground">
              <span>原：{item.before}</span>
              <span>新：{item.after}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const renderError = (result?: CommandResult) => {
  if (!result || result.status !== "error") return null;

  return (
    <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {result.message ?? "命令无法执行"}
      {result.candidates && result.candidates.length > 0 ? (
        <div className="mt-2 text-xs text-danger/90">
          可能的任务：
          <ul className="list-disc pl-4">
            {result.candidates.map((task) => (
              <li key={task.id}>{task.title} ({task.id})</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.blackoutCandidates && result.blackoutCandidates.length > 0 ? (
        <div className="mt-2 text-xs text-danger/90">
          可能的 blackout：
          <ul className="list-disc pl-4">
            {result.blackoutCandidates.map((window) => (
              <li key={window.id}>{blackoutRangeText(window.start, window.end)}（{window.reason}）</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

const renderSplit = (command: Extract<AiCommand, { type: "split_task" }>, result?: CommandResult) => {
  const parts = result?.created ?? command.payload.parts.map((part, index) => ({
    id: `part-${index}`,
    title: part.title,
    estimateMinutes: part.estimateMinutes ?? part.remainingMinutes,
    remainingMinutes: part.remainingMinutes ?? part.estimateMinutes,
    dueDate: part.dueDate ?? undefined,
    priority: part.priority,
  }));

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/90">拆分任务 {command.payload.target.taskId ?? command.payload.target.title ?? ""} 为 {parts.length} 个子任务</p>
      <div className="space-y-1.5">
        {parts.map((part) => (
          <div key={part.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div>
              <div className="font-semibold text-foreground">{part.title}</div>
              <div className="flex flex-wrap gap-3">
                <span>估时 {minutesText(part.estimateMinutes)}</span>
                <span>剩余 {minutesText(part.remainingMinutes)}</span>
              </div>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              due {dateText(part.dueDate as string | undefined)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const renderMerge = (command: Extract<AiCommand, { type: "merge_tasks" }>, result?: CommandResult) => {
  const merged = result?.created?.[0];
  const remaining = command.payload.remainingMinutes ?? merged?.remainingMinutes;

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/90">合并 {command.payload.targets.length} 个任务 → {command.payload.title}</p>
      <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">剩余</div>
          <div>{minutesText(remaining)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">优先级</div>
          <div>{priorityText(command.payload.priority ?? merged?.priority)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2 sm:col-span-3">
          <div className="font-semibold text-foreground">原任务</div>
          <div className="flex flex-wrap gap-2">
            {command.payload.targets.map((target, idx) => (
              <span key={idx} className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {target.taskId ?? target.title ?? target.fuzzyTitle ?? "unknown"}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const renderPayload = (command: AiCommand, result?: CommandResult) => {
  switch (command.type) {
    case "create_tasks": {
      const summary = `新增 ${command.payload.tasks.length} 个任务`;
      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">{summary}</p>
          <div className="space-y-2">
            {command.payload.tasks.map((task, taskIndex) => (
              <div
                key={`${task.title}-${taskIndex}`}
                className="rounded-xl border border-border/60 bg-surface/70 px-3 py-2 text-sm shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold leading-snug">{task.title}</div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {minutesText(task.estimateMinutes)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>截止 {task.dueDate ?? "未设置"}</span>
                  <span>优先级 {priorityText(task.priority)}</span>
                  <span>{task.locked ? "已锁定" : "可调整"}</span>
                  {task.note ? <span className="line-clamp-2 max-w-full">备注：{task.note}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "log_completion": {
      const target = command.payload.title ?? command.payload.taskId ?? "未指定任务";
      const pieces = [
        `记录 ${target}`,
        command.payload.minutesSpent ? `耗时 ${minutesText(command.payload.minutesSpent)}` : null,
        command.payload.markDone ? "并标记完成" : null,
      ].filter(Boolean);

      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">{pieces.join(" · ")}</p>
        </div>
      );
    }
    case "shrink_task": {
      const summary = `将 ${command.payload.taskId} 剩余工时改为 ${minutesText(command.payload.newRemainingMinutes)}`;
      return (
        <div className="space-y-1">
          <p className="text-sm text-foreground/90">{summary}</p>
          <p className="text-xs text-muted-foreground">原因：{command.payload.reason ?? "未说明"}</p>
        </div>
      );
    }
    case "add_blackout": {
      const summary = `标记不可用：${command.payload.start} → ${command.payload.end}`;
      return (
        <div className="space-y-1">
          <p className="text-sm text-foreground/90">{summary}</p>
          {command.payload.reason ? (
            <p className="text-xs text-muted-foreground">原因：{command.payload.reason}</p>
          ) : null}
        </div>
      );
    }
    case "update_blackout_window": {
      const targetLabel =
        command.payload.target.blackoutId ??
        (command.payload.target.startDate && command.payload.target.endDate
          ? blackoutRangeText(
              `${command.payload.target.startDate}T00:00:00Z`,
              `${command.payload.target.endDate}T00:00:00Z`,
            )
          : command.payload.target.fuzzyReason ?? "未指定");

      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">修改 blackout {targetLabel}</p>
          {renderBlackoutChanges(result?.blackoutChanges)}
        </div>
      );
    }
    case "delete_blackout_window": {
      const targetLabel =
        command.payload.target.blackoutId ??
        (command.payload.target.startDate && command.payload.target.endDate
          ? blackoutRangeText(
              `${command.payload.target.startDate}T00:00:00Z`,
              `${command.payload.target.endDate}T00:00:00Z`,
            )
          : command.payload.target.fuzzyReason ?? "未指定");

      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">删除 blackout {targetLabel}</p>
          {renderBlackoutChanges(result?.blackoutChanges)}
        </div>
      );
    }
    case "add_urgent_task": {
      const summary = `新增紧急任务：${command.payload.title}`;
      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">{summary}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <div className="font-semibold text-foreground">估时</div>
              <div>{minutesText(command.payload.estimateMinutes)}</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <div className="font-semibold text-foreground">截止</div>
              <div>{command.payload.dueDate}</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <div className="font-semibold text-foreground">窗口</div>
              <div>{command.payload.windowDays} 天</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <div className="font-semibold text-foreground">优先级</div>
              <div>{priorityText(command.payload.priority)}</div>
            </div>
          </div>
        </div>
      );
    }
    case "update_task_fields": {
      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">更新任务 {command.payload.target.taskId ?? command.payload.target.title ?? "未指定"}</p>
          <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            {command.payload.title !== undefined && <span className="rounded-lg bg-muted/40 px-3 py-2">标题 → {command.payload.title}</span>}
            {command.payload.estimateMinutes !== undefined && <span className="rounded-lg bg-muted/40 px-3 py-2">估时 → {minutesText(command.payload.estimateMinutes)}</span>}
            {command.payload.remainingMinutes !== undefined && <span className="rounded-lg bg-muted/40 px-3 py-2">剩余 → {minutesText(command.payload.remainingMinutes)}</span>}
            {command.payload.dueDate !== undefined && <span className="rounded-lg bg-muted/40 px-3 py-2">截止 → {dateText(command.payload.dueDate)}</span>}
            {command.payload.priority !== undefined && <span className="rounded-lg bg-muted/40 px-3 py-2">优先级 → {priorityText(command.payload.priority)}</span>}
            {command.payload.note !== undefined && <span className="rounded-lg bg-muted/40 px-3 py-2">备注 → {command.payload.note ?? "清空"}</span>}
          </div>
          {renderChanges(result?.changes)}
        </div>
      );
    }
    case "reschedule_task": {
      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">
            调整截止日期 {command.payload.target.taskId ?? command.payload.target.title ?? ""} → {dateText(command.payload.dueDate)}
          </p>
          {renderChanges(result?.changes)}
        </div>
      );
    }
    case "reprioritize_task": {
      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">
            提升优先级 {command.payload.target.taskId ?? command.payload.target.title ?? ""} → {priorityText(command.payload.priority)}
          </p>
          {renderChanges(result?.changes)}
        </div>
      );
    }
    case "pause_task":
    case "resume_task":
    case "delete_task":
    case "restore_task":
    case "mark_task_done":
    case "reopen_task": {
      const labelMap: Record<AiCommand["type"], string> = {
        pause_task: "暂停任务",
        resume_task: "恢复任务",
        delete_task: "删除任务",
        restore_task: "恢复删除任务",
        mark_task_done: "标记完成",
        reopen_task: "重新打开任务",
        update_blackout_window: "",
        delete_blackout_window: "",
        // unused mappings:
        create_tasks: "",
        log_completion: "",
        shrink_task: "",
        add_blackout: "",
        add_urgent_task: "",
        update_task_fields: "",
        reschedule_task: "",
        reprioritize_task: "",
        split_task: "",
        merge_tasks: "",
      };
      const extra =
        command.type === "reopen_task"
          ? `，剩余 ${minutesText(command.payload.remainingMinutes)}`
          : "";

      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/90">
            {labelMap[command.type]} {command.payload.target.taskId ?? command.payload.target.title ?? ""}{extra}
          </p>
          {renderChanges(result?.changes)}
        </div>
      );
    }
    case "split_task":
      return renderSplit(command, result);
    case "merge_tasks":
      return renderMerge(command, result);
    default:
      return <p className="text-sm text-muted-foreground">暂不支持的预览</p>;
  }
};

export function CommandPreviewCard({ command, index, result }: CommandPreviewCardProps) {
  const meta = commandMeta(command.type);
  const replanHint =
    result?.requiresReplan ??
    [
      "create_tasks",
      "log_completion",
      "shrink_task",
      "add_blackout",
      "add_urgent_task",
      "update_task_fields",
      "reschedule_task",
      "reprioritize_task",
      "pause_task",
      "resume_task",
      "delete_task",
      "restore_task",
      "split_task",
      "merge_tasks",
      "mark_task_done",
      "reopen_task",
    ].includes(command.type);

  return (
    <div
      className={`rounded-2xl border bg-surface/80 px-4 py-3 shadow-sm ring-1 ring-border/60 ${meta.toneClass}`}
      data-testid={`command-card-${index}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            #{index + 1}
          </span>
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${meta.accent}`}>
            {meta.label}
          </span>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {command.type}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          {replanHint ? <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning-foreground">会触发重排</span> : null}
          <span className="text-muted-foreground">仅预览</span>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {renderError(result)}
        {renderMatchedTasks(result?.matchedTasks)}
        {renderMatchedBlackouts(result?.matchedBlackouts)}
        {renderPayload(command, result)}
      </div>
    </div>
  );
}
