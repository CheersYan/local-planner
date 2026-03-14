import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { CommandResult } from "@/lib/commands/types";
import { CommandPreviewCard } from "../command-preview-card";

const renderHtml = (
  command: React.ComponentProps<typeof CommandPreviewCard>["command"],
  result?: CommandResult,
) => renderToStaticMarkup(<CommandPreviewCard command={command} index={0} result={result} />);

describe("CommandPreviewCard", () => {
  it("renders update_task_fields with matched task and changes", () => {
    const command = {
      type: "update_task_fields",
      payload: {
        target: { taskId: "task-1" },
        title: "写最终方案",
        estimateMinutes: 180,
        dueDate: "2026-03-25",
        priority: 3,
        note: null,
      },
    } as const;

    const html = renderHtml(command, {
      command,
      status: "ok",
      requiresReplan: true,
      matchedTasks: [
        {
          id: "task-1",
          title: "旧标题",
          status: "active",
          estimateMinutes: 120,
          remainingMinutes: 60,
          dueDate: "2026-03-20",
          priority: 2,
          note: "old",
        },
      ],
      changes: [
        {
          before: {
            id: "task-1",
            title: "旧标题",
            status: "active",
            estimateMinutes: 120,
            remainingMinutes: 60,
            dueDate: "2026-03-20",
            priority: 2,
            note: "old",
          },
          after: {
            id: "task-1",
            title: "写最终方案",
            status: "active",
            estimateMinutes: 180,
            remainingMinutes: 90,
            dueDate: "2026-03-25",
            priority: 3,
            note: null,
          },
        },
      ],
    });

    expect(html).toContain("更新任务 task-1");
    expect(html).toContain("写最终方案");
    expect(html).toContain("180 分钟");
    expect(html).toContain("旧标题");
    expect(html).toContain("2026-03-25");
    expect(html).toContain("变更前");
  });

  it("renders split_task preview", () => {
    const command: React.ComponentProps<typeof CommandPreviewCard>["command"] = {
      type: "split_task",
      payload: {
        target: { taskId: "task-2" },
        parts: [
          { title: "准备材料", estimateMinutes: 120 },
          { title: "排练", estimateMinutes: 180 },
        ],
      },
    };

    const html = renderHtml(command);

    expect(html).toContain("拆分任务 task-2");
    expect(html).toContain("准备材料");
    expect(html).toContain("排练");
  });

  it("renders update_blackout_window preview with changes", () => {
    const command = {
      type: "update_blackout_window",
      payload: {
        target: { blackoutId: "blk-1" },
        startDate: "2026-03-19",
        endDate: "2026-03-21",
        reason: "家庭安排",
      },
    } as const;

    const result: CommandResult = {
      command,
      status: "ok",
      requiresReplan: true,
      matchedBlackouts: [
        { id: "blk-1", start: "2026-03-18T00:00:00Z", end: "2026-03-20T23:59:59Z", reason: "出差" },
      ],
      blackoutChanges: [
        {
          before: { id: "blk-1", start: "2026-03-18T00:00:00Z", end: "2026-03-20T23:59:59Z", reason: "出差" },
          after: { id: "blk-1", start: "2026-03-19T00:00:00Z", end: "2026-03-21T23:59:59Z", reason: "家庭安排" },
        },
      ],
    };

    const html = renderHtml(command, result);

    expect(html).toContain("修改 blackout");
    expect(html).toContain("2026-03-18");
    expect(html).toContain("2026-03-21");
    expect(html).toContain("出差 → 家庭安排");
    expect(html).toContain("会触发重排");
  });

  it("renders delete_blackout_window preview", () => {
    const command = {
      type: "delete_blackout_window",
      payload: {
        target: { startDate: "2026-03-18", endDate: "2026-03-20" },
      },
    } as const;

    const result: CommandResult = {
      command,
      status: "ok",
      requiresReplan: true,
      matchedBlackouts: [
        { id: "blk-2", start: "2026-03-18T00:00:00Z", end: "2026-03-20T23:59:59Z", reason: "出差" },
      ],
      blackoutChanges: [
        {
          before: { id: "blk-2", start: "2026-03-18T00:00:00Z", end: "2026-03-20T23:59:59Z", reason: "出差" },
          after: null,
        },
      ],
    };

    const html = renderHtml(command, result);
    expect(html).toContain("删除 blackout");
    expect(html).toContain("出差");
    expect(html).toContain("会触发重排");
  });

  it("renders ambiguity candidates for blackout", () => {
    const command = {
      type: "update_blackout_window",
      payload: {
        target: { fuzzyReason: "出差" },
        reason: "调整",
      },
    } as const;

    const result: CommandResult = {
      command,
      status: "error",
      message: "Blackout reason is ambiguous",
      blackoutCandidates: [
        { id: "blk-1", start: "2026-03-18T00:00:00Z", end: "2026-03-20T23:59:59Z", reason: "出差" },
        { id: "blk-3", start: "2026-03-25T00:00:00Z", end: "2026-03-25T23:59:59Z", reason: "出差复盘" },
      ],
      requiresReplan: false,
    };

    const html = renderHtml(command, result);
    expect(html).toContain("可能的 blackout");
    expect(html).toContain("2026-03-18");
    expect(html).toContain("2026-03-25");
  });
});
