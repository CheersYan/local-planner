"use client";

import type { AiCommandBatch } from "@/lib/ai/command-schema";
import type { CommandResult } from "@/lib/commands/types";

import { CommandPreviewCard } from "./command-preview-card";

type CommandPreviewListProps = {
  commands: AiCommandBatch;
  results?: CommandResult[] | null;
  isLoading?: boolean;
  hasResult?: boolean;
  statusMessage?: string | null;
};

export function CommandPreviewList({
  commands,
  results,
  isLoading = false,
  hasResult = false,
  statusMessage,
}: CommandPreviewListProps) {
  const headerText = hasResult
    ? commands.length === 0
      ? "未识别到可执行操作"
      : `识别到 ${commands.length} 个操作`
    : "等待输入";

  return (
    <div className="rounded-2xl border border-border/70 bg-surface/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            识别到的操作
          </div>
          <div className="text-sm font-semibold text-foreground">{headerText}</div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
            isLoading
              ? "bg-muted text-muted-foreground"
              : commands.length > 0
                ? "bg-success/15 text-success"
                : "bg-muted/60 text-muted-foreground"
          }`}
        >
          {isLoading ? "解析中…" : "预览模式"}
        </span>
      </div>

      {statusMessage ? (
        <div className="mt-3 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm text-foreground">
          {statusMessage}
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
            <div className="h-24 animate-pulse rounded-xl bg-muted/60" />
          </div>
        ) : commands.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
            {hasResult
              ? "未识别到可执行操作，请补充细节或更换说法。"
              : "尚未提交消息。输入一句话让本地路由解析成可预览的命令。"}
          </div>
        ) : (
          commands.map((command, index) => (
            <CommandPreviewCard
              key={`${command.type}-${index}`}
              command={command}
              index={index}
              result={results?.[index]}
            />
          ))
        )}
      </div>
    </div>
  );
}
