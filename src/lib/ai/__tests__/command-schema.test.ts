import { describe, expect, it } from "vitest";

import {
  AddBlackoutCommand,
  AiCommand,
  aiCommandBatchSchema,
  aiCommandSchema,
  aiReadableContextSchema,
  DeleteBlackoutWindowCommand,
  LogCompletionCommand,
  ReopenTaskCommand,
  ShrinkTaskCommand,
  UpdateBlackoutWindowCommand,
  UpdateTaskFieldsCommand,
  addBlackoutCommandSchema,
  deleteBlackoutWindowCommandSchema,
  logCompletionCommandSchema,
  reopenTaskCommandSchema,
  shrinkTaskCommandSchema,
  updateBlackoutWindowCommandSchema,
  updateTaskFieldsCommandSchema,
} from "../command-schema";

const commandFixtures: AiCommand[] = [
  {
    type: "create_tasks",
    payload: {
      tasks: [
        {
          title: "Write onboarding doc",
          estimateMinutes: 90,
          dueDate: "2026-03-15",
          priority: 2,
          locked: false,
        },
        { title: "Polish UI", estimateMinutes: 60, priority: 1, locked: false },
      ],
      requestId: "msg-001",
    },
  },
  {
    type: "log_completion",
    payload: {
      taskId: "task-123",
      title: undefined,
      minutesSpent: 45,
      markDone: true,
      note: "Shipped core logic",
      loggedAt: "2026-03-12T01:30:00Z",
    },
  },
  {
    type: "shrink_task",
    payload: {
      taskId: "task-abc",
      newRemainingMinutes: 60,
      previousEstimateMinutes: 120,
      reason: "Scope trimmed to MVP",
    },
  },
  {
    type: "add_blackout",
    payload: {
      start: "2026-03-18T00:00:00Z",
      end: "2026-03-19T23:59:00Z",
      reason: "Offsite",
    },
  },
  {
    type: "update_blackout_window",
    payload: {
      target: { blackoutId: "blk-1" },
      startDate: "2026-03-19",
      endDate: "2026-03-21",
      reason: "家庭安排",
    },
  },
  {
    type: "delete_blackout_window",
    payload: {
      target: { startDate: "2026-03-18", endDate: "2026-03-20" },
    },
  },
  {
    type: "add_urgent_task",
    payload: {
      title: "Hotfix billing",
      estimateMinutes: 90,
      dueDate: "2026-03-13",
      priority: 10,
      windowDays: 2,
      reason: "Customer blocked",
      locked: false,
    },
  },
  {
    type: "update_task_fields",
    payload: {
      target: { taskId: "task-rename" },
      title: "New title",
    },
  },
  {
    type: "reschedule_task",
    payload: {
      target: { taskId: "task-move" },
      dueDate: "2026-03-18",
      reason: "Move deadline",
    },
  },
  {
    type: "reprioritize_task",
    payload: {
      target: { taskId: "task-priority" },
      priority: 3,
      reason: "High visibility",
    },
  },
  {
    type: "pause_task",
    payload: { target: { taskId: "task-pause" }, reason: "Blocked" },
  },
  {
    type: "resume_task",
    payload: { target: { taskId: "task-resume" } },
  },
  {
    type: "delete_task",
    payload: { target: { taskId: "task-delete" }, reason: "duplicate" },
  },
  {
    type: "restore_task",
    payload: { target: { taskId: "task-restore" } },
  },
  {
    type: "split_task",
    payload: {
      target: { taskId: "task-split" },
      parts: [
        { title: "Part A", estimateMinutes: 120, dueDate: null, note: null },
        { title: "Part B", estimateMinutes: 60, dueDate: null, note: null },
      ],
      reason: "Too big",
    },
  },
  {
    type: "merge_tasks",
      payload: {
        targets: [{ taskId: "task-a" }, { taskId: "task-b" }],
        title: "Merged task",
        remainingMinutes: 180,
        dueDate: null,
        note: null,
      },
    },
  {
    type: "mark_task_done",
    payload: {
      target: { taskId: "task-done" },
      note: null,
    },
  },
  {
    type: "reopen_task",
    payload: {
      target: { taskId: "task-reopen" },
      remainingMinutes: 90,
      note: null,
    },
  },
];

describe("aiCommandSchema", () => {
  it("accepts all command fixtures", () => {
    for (const fixture of commandFixtures) {
      expect(() => aiCommandSchema.parse(fixture)).not.toThrow();
    }
  });

  it("rejects log_completion without an identifier", () => {
    const invalid: LogCompletionCommand = {
      type: "log_completion",
      payload: { minutesSpent: 30, markDone: false },
    };

    expect(() => logCompletionCommandSchema.parse(invalid)).toThrow(/taskId or title/i);
  });

  it("requires shrink_task to actually shrink estimates when previousEstimateMinutes is provided", () => {
    const invalid: ShrinkTaskCommand = {
      type: "shrink_task",
      payload: {
        taskId: "task-xyz",
        newRemainingMinutes: 120,
        previousEstimateMinutes: 60,
      },
    };

    expect(() => shrinkTaskCommandSchema.parse(invalid)).toThrow(/previousEstimateMinutes/i);
  });

  it("requires blackout end to follow start", () => {
    const invalid: AddBlackoutCommand = {
      type: "add_blackout",
      payload: {
        start: "2026-03-20T10:00:00Z",
        end: "2026-03-19T10:00:00Z",
        reason: "invalid window",
      },
    };

    expect(() => addBlackoutCommandSchema.parse(invalid)).toThrow(/after start/i);
  });

  it("allows shrink_task payloads with zero newRemainingMinutes", () => {
    const zero: ShrinkTaskCommand = {
      type: "shrink_task",
      payload: {
        taskId: "task-zero",
        newRemainingMinutes: 0,
        previousEstimateMinutes: 30,
      },
    };

    expect(() => shrinkTaskCommandSchema.parse(zero)).not.toThrow();
  });

  it("accepts database task snapshots for AI context", () => {
    const context = aiReadableContextSchema.parse({
      tasks: [
        {
          id: "task-existing",
          title: "Existing backlog item",
          status: "active",
          estimateMinutes: 120,
          dueDate: "2026-03-25",
          plannedDate: "2026-03-22",
          priority: 3,
          locked: false,
        },
      ],
    });

    expect(context.tasks[0]).toMatchObject({
      id: "task-existing",
      status: "active",
    });
  });

  it("accepts extended AI context fields", () => {
    const context = aiReadableContextSchema.parse({
      todayLocalDate: "2026-03-12",
      timezone: "Australia/Sydney",
      dailyCapacityHours: 6.5,
      blackouts: [
        {
          id: "blk-1",
          start: "2026-03-15T09:00:00+11:00",
          end: "2026-03-15T12:00:00+11:00",
          reason: "Travel",
        },
      ],
      tasks: [
        {
          id: "task-context",
          title: "Review PR",
          status: "paused",
          estimateMinutes: 120,
          actualMinutes: 30,
          remainingMinutes: 70,
          priority: 2,
          locked: false,
        },
      ],
    });

    expect(context.todayLocalDate).toBe("2026-03-12");
    expect(context.blackouts[0]).toMatchObject({ id: "blk-1", reason: "Travel" });
    expect(context.tasks[0].remainingMinutes).toBe(70);
  });

  it("rejects context blackout windows where end precedes start", () => {
    expect(() =>
      aiReadableContextSchema.parse({
        blackouts: [
          { start: "2026-03-15T12:00:00Z", end: "2026-03-15T09:00:00Z", reason: "Invalid" },
        ],
      })
    ).toThrow(/after start/i);
  });

  it("allows empty command batches when nothing should be executed", () => {
    expect(() => aiCommandBatchSchema.parse([])).not.toThrow();
  });

  it("rejects update_task_fields when no fields besides target are provided", () => {
    const invalid: UpdateTaskFieldsCommand = {
      type: "update_task_fields",
      payload: { target: { taskId: "task-empty" } },
    };

    expect(() => updateTaskFieldsCommandSchema.parse(invalid)).toThrow(/At least one field/i);
  });

  it("accepts update_task_fields renames only", () => {
    const renameOnly: UpdateTaskFieldsCommand = {
      type: "update_task_fields",
      payload: { target: { taskId: "task-1" }, title: "写最终方案" },
    };

    expect(() => updateTaskFieldsCommandSchema.parse(renameOnly)).not.toThrow();
  });

  it("accepts update_task_fields estimate + dueDate + priority", () => {
    const combo: UpdateTaskFieldsCommand = {
      type: "update_task_fields",
      payload: {
        target: { taskId: "task-2" },
        estimateMinutes: 180,
        dueDate: "2026-03-25",
        priority: 3,
      },
    };

    expect(() => updateTaskFieldsCommandSchema.parse(combo)).not.toThrow();
  });

  it("accepts update_task_fields clearing note", () => {
    const clearNote: UpdateTaskFieldsCommand = {
      type: "update_task_fields",
      payload: { target: { taskId: "task-3" }, note: null },
    };

    expect(() => updateTaskFieldsCommandSchema.parse(clearNote)).not.toThrow();
  });

  it("accepts split_task with two parts", () => {
    expect(() => aiCommandSchema.parse(commandFixtures.find((c) => c.type === "split_task"))).not.toThrow();
  });

  it("accepts reopen_task with remainingMinutes", () => {
    const reopen: ReopenTaskCommand = {
      type: "reopen_task",
      payload: { target: { taskId: "task-x" }, remainingMinutes: 30 },
    };

    expect(() => reopenTaskCommandSchema.parse(reopen)).not.toThrow();
  });

  it("requires update_blackout_window to provide at least one field", () => {
    const invalid: UpdateBlackoutWindowCommand = {
      type: "update_blackout_window",
      payload: { target: { blackoutId: "blk-1" } },
    } as UpdateBlackoutWindowCommand;

    expect(() => updateBlackoutWindowCommandSchema.parse(invalid)).toThrow(/At least one field/i);
  });

  it("rejects update_blackout_window when end precedes start", () => {
    const invalid: UpdateBlackoutWindowCommand = {
      type: "update_blackout_window",
      payload: {
        target: { blackoutId: "blk-1" },
        startDate: "2026-03-21",
        endDate: "2026-03-20",
      },
    } as UpdateBlackoutWindowCommand;

    expect(() => updateBlackoutWindowCommandSchema.parse(invalid)).toThrow(/after start/i);
  });

  it("requires blackout locator date ranges to be paired", () => {
    const invalid: DeleteBlackoutWindowCommand = {
      type: "delete_blackout_window",
      payload: { target: { startDate: "2026-03-20" } },
    };

    expect(() => deleteBlackoutWindowCommandSchema.parse(invalid)).toThrow(/provided together/i);
  });
});
