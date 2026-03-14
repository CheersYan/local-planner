import { describe, expect, it } from "vitest";

import {
  ModelAddBlackoutCommand,
  ModelAddUrgentTaskCommand,
  ModelAiCommandEnvelope,
  ModelDeleteBlackoutWindowCommand,
  ModelLogCompletionCommand,
  ModelUpdateBlackoutWindowCommand,
  ModelReopenTaskCommand,
  ModelShrinkTaskCommand,
  ModelUpdateTaskFieldsCommand,
  modelAddBlackoutCommandSchema,
  modelAddUrgentTaskCommandSchema,
  modelDeleteBlackoutWindowCommandSchema,
  modelCommandEnvelopeSchema,
  modelCreateTasksCommandSchema,
  modelLogCompletionCommandSchema,
  modelReopenTaskCommandSchema,
  modelUpdateBlackoutWindowCommandSchema,
  modelRescheduleTaskCommandSchema,
  modelShrinkTaskCommandSchema,
  modelUpdateTaskFieldsCommandSchema,
} from "../model-command-schema";

const envelopeFixture: ModelAiCommandEnvelope = {
  commands: [
    {
      type: "create_tasks",
      payload: {
        tasks: [
          {
            title: "Task A",
            estimateMinutes: 60,
            dueDate: null,
            priority: "medium",
            locked: false,
            note: null,
          },
        ],
        requestId: null,
      },
    },
  ],
};

describe("modelCommandEnvelopeSchema", () => {
  it("accepts a valid envelope", () => {
    expect(() => modelCommandEnvelopeSchema.parse(envelopeFixture)).not.toThrow();
  });

  it("rejects envelopes that are not objects", () => {
    expect(modelCommandEnvelopeSchema.safeParse(envelopeFixture.commands).success).toBe(false);
  });

  it("allows empty envelopes", () => {
    const emptyEnvelope: ModelAiCommandEnvelope = { commands: [] };
    expect(modelCommandEnvelopeSchema.safeParse(emptyEnvelope).success).toBe(true);
  });
});

describe("model command schemas", () => {
  it("accepts a shrink_task with zero remaining", () => {
    const zeroRemaining: ModelShrinkTaskCommand = {
      type: "shrink_task",
      payload: {
        taskId: "task-zero",
        newRemainingMinutes: 0,
        previousEstimateMinutes: 30,
        reason: null,
      },
    };

    expect(() => modelShrinkTaskCommandSchema.parse(zeroRemaining)).not.toThrow();
  });

  it("rejects shrink_task that expands remaining minutes", () => {
    const invalid: ModelShrinkTaskCommand = {
      type: "shrink_task",
      payload: {
        taskId: "task-xyz",
        newRemainingMinutes: 120,
        previousEstimateMinutes: 60,
        reason: null,
      },
    };

    expect(() => modelShrinkTaskCommandSchema.parse(invalid)).toThrow(/previousEstimateMinutes/);
  });

  it("rejects add_blackout when end precedes start", () => {
    const invalid: ModelAddBlackoutCommand = {
      type: "add_blackout",
      payload: { startDate: "2026-03-20", endDate: "2026-03-19", reason: "bad" },
    };

    expect(() => modelAddBlackoutCommandSchema.parse(invalid)).toThrow(/endDate/);
  });

  it("accepts add_blackout same-day window", () => {
    const sameDay: ModelAddBlackoutCommand = {
      type: "add_blackout",
      payload: { startDate: "2026-03-20", endDate: "2026-03-20", reason: "one day" },
    };

    expect(() => modelAddBlackoutCommandSchema.parse(sameDay)).not.toThrow();
  });

  it("accepts create_tasks", () => {
    const valid = envelopeFixture.commands[0];
    expect(modelCreateTasksCommandSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects create_tasks without tasks", () => {
    const invalid = {
      type: "create_tasks",
      payload: { tasks: [], requestId: null },
    };
    expect(modelCreateTasksCommandSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects log_completion without identifier", () => {
    const invalid: ModelLogCompletionCommand = {
      type: "log_completion",
      payload: {
        taskId: null,
        title: null,
        minutesSpent: 30,
        markDone: false,
        note: null,
        loggedAt: null,
      },
    };

    expect(() => modelLogCompletionCommandSchema.parse(invalid)).toThrow(/taskId or title/);
  });

  it("rejects update_task_fields without fields", () => {
    const invalid: ModelUpdateTaskFieldsCommand = {
      type: "update_task_fields",
      payload: {
        target: { taskId: "x", title: null, fuzzyTitle: null },
        title: null,
        estimateHours: null,
        remainingHours: null,
        dueDate: null,
        priority: null,
        note: null,
      },
    };
    expect(() => modelUpdateTaskFieldsCommandSchema.parse(invalid)).toThrow(/At least one field/);
  });

  it("accepts reschedule_task with dueDate", () => {
    expect(() =>
      modelRescheduleTaskCommandSchema.parse({
        type: "reschedule_task",
        payload: { target: { taskId: "id1", title: null, fuzzyTitle: null }, dueDate: "2026-03-30", reason: null },
      })
    ).not.toThrow();
  });

  it("accepts add_urgent_task", () => {
    const valid: ModelAddUrgentTaskCommand = {
      type: "add_urgent_task",
      payload: {
        title: "Hotfix",
        estimateMinutes: 120,
        dueDate: "2026-04-01",
        priority: "urgent",
        windowDays: 3,
        note: null,
        reason: "blocking issue",
      },
    };
    expect(() => modelAddUrgentTaskCommandSchema.parse(valid)).not.toThrow();
  });

  it("accepts reopen_task with remainingHours", () => {
    const reopen: ModelReopenTaskCommand = {
      type: "reopen_task",
      payload: { target: { taskId: "task-x", title: null, fuzzyTitle: null }, remainingHours: 1.5, note: null },
    };
    expect(() => modelReopenTaskCommandSchema.parse(reopen)).not.toThrow();
  });

  it("requires update_blackout_window to provide at least one field", () => {
    const invalid: ModelUpdateBlackoutWindowCommand = {
      type: "update_blackout_window",
      payload: { target: { blackoutId: "blk-1", startDate: null, endDate: null, fuzzyReason: null }, startDate: null, endDate: null, reason: null },
    };

    expect(() => modelUpdateBlackoutWindowCommandSchema.parse(invalid)).toThrow(/At least one field/i);
  });

  it("rejects update_blackout_window when end precedes start", () => {
    const invalid: ModelUpdateBlackoutWindowCommand = {
      type: "update_blackout_window",
      payload: {
        target: { blackoutId: null, startDate: null, endDate: null, fuzzyReason: "出差" },
        startDate: "2026-03-21",
        endDate: "2026-03-20",
        reason: null,
      },
    };

    expect(() => modelUpdateBlackoutWindowCommandSchema.parse(invalid)).toThrow(/after start/i);
  });

  it("requires blackout locator date pairs for delete_blackout_window", () => {
    const invalid: ModelDeleteBlackoutWindowCommand = {
      type: "delete_blackout_window",
      payload: { target: { blackoutId: null, startDate: "2026-03-18", endDate: null, fuzzyReason: null } },
    };

    expect(() => modelDeleteBlackoutWindowCommandSchema.parse(invalid)).toThrow(/provided together/i);
  });
});
