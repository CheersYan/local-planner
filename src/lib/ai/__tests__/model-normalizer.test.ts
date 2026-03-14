import { describe, expect, it } from "vitest";

import { aiCommandBatchSchema } from "../command-schema";
import {
  ModelAddBlackoutCommand,
  ModelAddUrgentTaskCommand,
  ModelAiCommandEnvelope,
  ModelCreateTasksCommand,
  ModelDeleteBlackoutWindowCommand,
  ModelLogCompletionCommand,
  ModelReopenTaskCommand,
  ModelRescheduleTaskCommand,
  ModelSplitTaskCommand,
  ModelUpdateBlackoutWindowCommand,
  ModelUpdateTaskFieldsCommand,
} from "../model-command-schema";
import { normalizeModelCommandForTest, normalizeModelEnvelope, normalizePriorityForTest } from "../model-normalizer";

describe("normalizeModelCommandForTest", () => {
  it("normalizes create_tasks", () => {
    const command: ModelCreateTasksCommand = {
      type: "create_tasks",
      payload: {
        tasks: [
          {
            title: "Task A",
            estimateMinutes: 90,
            dueDate: null,
            priority: "medium",
            locked: true,
            note: null,
          },
        ],
        requestId: "req-1",
      },
    };

    expect(normalizeModelCommandForTest(command)).toEqual({
      type: "create_tasks",
      payload: {
        tasks: [{ title: "Task A", estimateMinutes: 90, dueDate: undefined, priority: 2, locked: true, note: undefined }],
        requestId: "req-1",
      },
    });
  });

  it("normalizes log_completion", () => {
    const command: ModelLogCompletionCommand = {
      type: "log_completion",
      payload: {
        taskId: "id-1",
        title: null,
        minutesSpent: 30,
        markDone: false,
        note: null,
        loggedAt: "2026-03-13T10:00:00Z",
      },
    };

    expect(normalizeModelCommandForTest(command)).toEqual({
      type: "log_completion",
      payload: {
        taskId: "id-1",
        title: undefined,
        minutesSpent: 30,
        markDone: false,
        note: undefined,
        loggedAt: "2026-03-13T10:00:00Z",
      },
    });
  });

  it("normalizes add_blackout to datetime range", () => {
    const command: ModelAddBlackoutCommand = {
      type: "add_blackout",
      payload: { startDate: "2026-03-20", endDate: "2026-03-21", reason: "offsite" },
    };

    expect(normalizeModelCommandForTest(command)).toEqual({
      type: "add_blackout",
      payload: {
        start: "2026-03-20T00:00:00Z",
        end: "2026-03-21T23:59:59Z",
        reason: "offsite",
      },
    });
  });

  it("normalizes update_blackout_window with optional fields", () => {
    const command: ModelUpdateBlackoutWindowCommand = {
      type: "update_blackout_window",
      payload: {
        target: { blackoutId: "blk-1", startDate: null, endDate: null, fuzzyReason: null },
        startDate: "2026-03-19",
        endDate: "2026-03-21",
        reason: "家庭安排",
      },
    };

    expect(normalizeModelCommandForTest(command)).toEqual({
      type: "update_blackout_window",
      payload: {
        target: { blackoutId: "blk-1", startDate: undefined, endDate: undefined, fuzzyReason: undefined },
        startDate: "2026-03-19",
        endDate: "2026-03-21",
        reason: "家庭安排",
      },
    });
  });

  it("normalizes delete_blackout_window", () => {
    const command: ModelDeleteBlackoutWindowCommand = {
      type: "delete_blackout_window",
      payload: { target: { blackoutId: null, startDate: "2026-03-18", endDate: "2026-03-20", fuzzyReason: null } },
    };

    expect(normalizeModelCommandForTest(command)).toEqual({
      type: "delete_blackout_window",
      payload: { target: { blackoutId: undefined, startDate: "2026-03-18", endDate: "2026-03-20", fuzzyReason: undefined } },
    });
  });

  it("normalizes add_urgent_task priority to number", () => {
    const command: ModelAddUrgentTaskCommand = {
      type: "add_urgent_task",
      payload: {
        title: "Hotfix",
        estimateMinutes: 60,
        dueDate: "2026-03-22",
        priority: "urgent",
        windowDays: 2,
        note: null,
        reason: null,
      },
    };

    const normalized = normalizeModelCommandForTest(command);
    expect(normalized).toMatchObject({
      type: "add_urgent_task",
      payload: { priority: 10, windowDays: 2 },
    });
  });

  it("normalizes update_task_fields hours to minutes", () => {
    const command: ModelUpdateTaskFieldsCommand = {
      type: "update_task_fields",
      payload: {
        target: { taskId: "task-1", title: null, fuzzyTitle: null },
        title: "Renamed",
        estimateHours: 2.5,
        remainingHours: 1.5,
        dueDate: "2026-03-25",
        priority: "high",
        note: null,
      },
    };

    expect(normalizeModelCommandForTest(command)).toEqual({
      type: "update_task_fields",
      payload: {
        target: { taskId: "task-1", title: undefined, fuzzyTitle: undefined },
        title: "Renamed",
        estimateMinutes: 150,
        remainingMinutes: 90,
        dueDate: "2026-03-25",
        priority: 3,
        note: null,
      },
    });
  });

  it("normalizes reschedule_task", () => {
    const command: ModelRescheduleTaskCommand = {
      type: "reschedule_task",
      payload: {
        target: { taskId: "task-2", title: null, fuzzyTitle: null },
        dueDate: "2026-04-01",
        reason: null,
      },
    };

    expect(normalizeModelCommandForTest(command)).toEqual({
      type: "reschedule_task",
      payload: {
        target: { taskId: "task-2", title: undefined, fuzzyTitle: undefined },
        dueDate: "2026-04-01",
        reason: undefined,
      },
    });
  });

  it("normalizes split_task parts", () => {
    const command: ModelSplitTaskCommand = {
      type: "split_task",
      payload: {
        target: { taskId: "task-3", title: null, fuzzyTitle: null },
        parts: [
          { title: "Part1", estimateHours: 1, remainingHours: null, dueDate: null, priority: "medium", note: null },
          { title: "Part2", estimateHours: 0.5, remainingHours: null, dueDate: null, priority: null, note: null },
        ],
        reason: null,
      },
    };

    const normalized = normalizeModelCommandForTest(command);
    expect(normalized.type).toBe("split_task");
    if (normalized.type === "split_task") {
      expect(normalized.payload.parts[0].estimateMinutes).toBe(60);
    }
  });

  it("normalizes reopen_task remainingHours to minutes", () => {
    const reopen: ModelReopenTaskCommand = {
      type: "reopen_task",
      payload: { target: { taskId: "task-x", title: null, fuzzyTitle: null }, remainingHours: 2, note: null },
    };

    const normalized = normalizeModelCommandForTest(reopen);
    expect(normalized).toEqual({
      type: "reopen_task",
      payload: {
        target: { taskId: "task-x", title: undefined, fuzzyTitle: undefined },
        remainingMinutes: 120,
        note: null,
      },
    });
  });
});

describe("normalizeModelEnvelope", () => {
  it("returns batches accepted by aiCommandBatchSchema", () => {
    const envelope: ModelAiCommandEnvelope = {
      commands: [
        {
          type: "reschedule_task",
          payload: { target: { taskId: "t1", title: null, fuzzyTitle: null }, dueDate: "2026-03-31", reason: null },
        },
      ],
    };

    const batch = normalizeModelEnvelope(envelope);
    expect(() => aiCommandBatchSchema.parse(batch)).not.toThrow();
  });
});

describe("normalizePriorityForTest", () => {
  it("maps model priority to numeric priority", () => {
    expect(normalizePriorityForTest("low")).toBe(1);
    expect(normalizePriorityForTest("urgent")).toBe(10);
  });
});
