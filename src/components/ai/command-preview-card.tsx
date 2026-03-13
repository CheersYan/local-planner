"use client";

import type { AiCommand } from "@/lib/ai/command-schema";

type CommandPreviewCardProps = {
  command: AiCommand;
  index: number;
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
    case "add_urgent_task":
      return { label: "Add urgent task", accent: "bg-danger/15 text-danger", toneClass: "border-danger/40" };
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

const timeText = (value?: string | null): string => {
  if (!value) return "未提供";
  return value.replace("T", " ").replace("Z", " UTC");
};

const minutesText = (value?: number | null): string => {
  if (value === null || value === undefined) return "未提供";
  if (!Number.isFinite(value)) return "未提供";
  return `${value} 分钟`;
};

const noteText = (value?: string | null): string | null => {
  if (!value) return null;
  return value;
};

const renderCreateTasks = (command: Extract<AiCommand, { type: "create_tasks" }>) => {
  const count = command.payload.tasks.length;
  const summary = `新增 ${count} 个任务`;

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
};

const renderLogCompletion = (command: Extract<AiCommand, { type: "log_completion" }>) => {
  const target = command.payload.title ?? command.payload.taskId ?? "未指定任务";
  const pieces = [
    `记录 ${target}`,
    command.payload.minutesSpent ? `耗时 ${minutesText(command.payload.minutesSpent)}` : null,
    command.payload.markDone ? "并标记完成" : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/90">{pieces.join(" · ")}</p>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">任务</div>
          <div>{target}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">用时</div>
          <div>{minutesText(command.payload.minutesSpent)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">记录时间</div>
          <div className="break-words">{timeText(command.payload.loggedAt)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2 sm:col-span-3">
          <div className="font-semibold text-foreground">备注</div>
          <div>{noteText(command.payload.note) ?? "无"}</div>
        </div>
      </div>
    </div>
  );
};

const renderShrinkTask = (command: Extract<AiCommand, { type: "shrink_task" }>) => {
  const summary = `将 ${command.payload.taskId} 剩余工时改为 ${minutesText(command.payload.newRemainingMinutes)}`;

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/90">{summary}</p>
      <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">任务</div>
          <div>{command.payload.taskId}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">新的剩余</div>
          <div>{minutesText(command.payload.newRemainingMinutes)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">之前估时</div>
          <div>{minutesText(command.payload.previousEstimateMinutes)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2 sm:col-span-3">
          <div className="font-semibold text-foreground">原因</div>
          <div>{noteText(command.payload.reason) ?? "未说明"}</div>
        </div>
      </div>
    </div>
  );
};

const renderBlackout = (command: Extract<AiCommand, { type: "add_blackout" }>) => {
  const summary = `标记不可用：${timeText(command.payload.start)} → ${timeText(command.payload.end)}`;
  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/90">{summary}</p>
      <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">开始</div>
          <div className="break-words">{timeText(command.payload.start)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="font-semibold text-foreground">结束</div>
          <div className="break-words">{timeText(command.payload.end)}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2 sm:col-span-3">
          <div className="font-semibold text-foreground">原因</div>
          <div>{command.payload.reason}</div>
        </div>
      </div>
    </div>
  );
};

const renderUrgentTask = (command: Extract<AiCommand, { type: "add_urgent_task" }>) => {
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
        <div className="rounded-lg bg-muted/40 px-3 py-2 sm:col-span-4">
          <div className="font-semibold text-foreground">原因</div>
          <div>{noteText(command.payload.reason) ?? "未说明"}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2 sm:col-span-4">
          <div className="font-semibold text-foreground">备注</div>
          <div>{noteText(command.payload.note) ?? "无"}</div>
        </div>
      </div>
    </div>
  );
};

export function CommandPreviewCard({ command, index }: CommandPreviewCardProps) {
  const meta = commandMeta(command.type);

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
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">仅预览，不执行</span>
      </div>

      <div className="mt-3">
        {command.type === "create_tasks" && renderCreateTasks(command)}
        {command.type === "log_completion" && renderLogCompletion(command)}
        {command.type === "shrink_task" && renderShrinkTask(command)}
        {command.type === "add_blackout" && renderBlackout(command)}
        {command.type === "add_urgent_task" && renderUrgentTask(command)}
      </div>
    </div>
  );
}
