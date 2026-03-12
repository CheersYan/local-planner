import { describe, expect, it } from "vitest";

import {
  ModelAddBlackoutCommand,
  ModelAddUrgentTaskCommand,
  ModelAiCommandEnvelope,
  ModelLogCompletionCommand,
  ModelShrinkTaskCommand,
  modelAddBlackoutCommandSchema,
  modelAddUrgentTaskCommandSchema,
  modelCommandSchema,
  modelCommandEnvelopeSchema,
  modelCreateTasksCommandSchema,
  modelLogCompletionCommandSchema,
  modelShrinkTaskCommandSchema,
} from "../model-command-schema";

const envelopeFixture: ModelAiCommandEnvelope = {
  commands: [
    {
      type: "create_tasks",
      payload: {
        tasks: [
          {
            title: "Write onboarding doc",
            estimateMinutes: 90,
            dueDate: null,
            priority: "medium",
            locked: false,
            note: null,
          },
        ],
        requestId: null,
      },
    },
    {
      type: "log_completion",
      payload: {
        taskId: "task-123",
        title: null,
        minutesSpent: null,
        markDone: true,
        note: null,
        loggedAt: null,
      },
    },
    {
      type: "shrink_task",
      payload: {
        taskId: "task-abc",
        newRemainingMinutes: 0,
        previousEstimateMinutes: 45,
        reason: "Scoped to MVP",
      },
    },
    {
      type: "add_blackout",
      payload: {
        startDate: "2026-03-20",
        endDate: "2026-03-21",
        reason: "Offsite",
      },
    },
    {
      type: "add_urgent_task",
      payload: {
        title: "Hotfix billing",
        estimateMinutes: 90,
        dueDate: "2026-03-13",
        priority: "urgent",
        windowDays: 3,
        note: null,
        reason: "Customer blocked",
      },
    },
  ],
};

describe("modelCommandEnvelopeSchema", () => {
  it("accepts the object envelope and rejects a bare array root", () => {
    expect(() => modelCommandEnvelopeSchema.parse(envelopeFixture)).not.toThrow();
    expect(modelCommandEnvelopeSchema.safeParse(envelopeFixture.commands).success).toBe(false);
  });

  it("rejects empty command lists", () => {
    const emptyEnvelope: ModelAiCommandEnvelope = { commands: [] };
    expect(modelCommandEnvelopeSchema.safeParse(emptyEnvelope).success).toBe(false);
  });

  it("rejects extra root keys because of strict mode", () => {
    const envelopeWithExtra = { ...envelopeFixture, extra: "noop" } as unknown;
    expect(modelCommandEnvelopeSchema.safeParse(envelopeWithExtra).success).toBe(false);
  });

  it("rejects unknown command types", () => {
    const invalidEnvelope = {
      commands: [{ type: "noop", payload: {} }],
    } as unknown;

    expect(modelCommandEnvelopeSchema.safeParse(invalidEnvelope).success).toBe(false);
  });

  it("rejects nested payload extra keys", () => {
    const envelopeWithNestedExtra = {
      commands: [
        {
          type: "create_tasks",
          payload: {
            tasks: [
              {
                title: "Task",
                estimateMinutes: 30,
                dueDate: null,
                priority: "low",
                locked: false,
                note: null,
                extra: "nope",
              },
            ],
            requestId: null,
          },
        },
      ],
    } as unknown;

    expect(modelCommandEnvelopeSchema.safeParse(envelopeWithNestedExtra).success).toBe(false);
  });
});

describe("nullable fields", () => {
  it("accepts nulls on nullable fields", () => {
    expect(() => modelCommandEnvelopeSchema.parse(envelopeFixture)).not.toThrow();
  });
});

describe("date validation", () => {
  it("rejects impossible dates like 2026-02-30", () => {
    const invalidBlackout: ModelAddBlackoutCommand = {
      type: "add_blackout",
      payload: {
        startDate: "2026-02-30",
        endDate: "2026-03-01",
        reason: "bad date",
      },
    };

    expect(() => modelAddBlackoutCommandSchema.parse(invalidBlackout)).toThrow(/calendar date/);
  });

  it("rejects blackout ranges where endDate < startDate", () => {
    const invalidBlackout: ModelAddBlackoutCommand = {
      type: "add_blackout",
      payload: {
        startDate: "2026-03-10",
        endDate: "2026-03-09",
        reason: "reverse",
      },
    };

    expect(() => modelAddBlackoutCommandSchema.parse(invalidBlackout)).toThrow(/endDate/);
  });

  it("accepts timezone-offset datetimes for loggedAt", () => {
    const valid: ModelLogCompletionCommand = {
      type: "log_completion",
      payload: {
        taskId: "task-tz",
        title: null,
        minutesSpent: 15,
        markDone: true,
        note: null,
        loggedAt: "2026-03-12T10:00:00+08:00",
      },
    };

    expect(() => modelLogCompletionCommandSchema.parse(valid)).not.toThrow();
  });
});

describe("log_completion rules", () => {
  it("fails when both taskId and title are null", () => {
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

  it("fails when minutesSpent is null but markDone is false", () => {
    const invalid: ModelLogCompletionCommand = {
      type: "log_completion",
      payload: {
        taskId: "task-xyz",
        title: null,
        minutesSpent: null,
        markDone: false,
        note: null,
        loggedAt: null,
      },
    };

    expect(() => modelLogCompletionCommandSchema.parse(invalid)).toThrow(/markDone/);
  });

  it("accepts title-only log_completion commands", () => {
    const valid: ModelLogCompletionCommand = {
      type: "log_completion",
      payload: {
        taskId: null,
        title: "Loose chore",
        minutesSpent: 20,
        markDone: false,
        note: null,
        loggedAt: "2026-03-12T01:00:00Z",
      },
    };

    expect(() => modelLogCompletionCommandSchema.parse(valid)).not.toThrow();
  });

  it("allows markDone with null minutesSpent", () => {
    const valid: ModelLogCompletionCommand = {
      type: "log_completion",
      payload: {
        taskId: "task-done",
        title: null,
        minutesSpent: null,
        markDone: true,
        note: null,
        loggedAt: "2026-03-12T01:00:00Z",
      },
    };

    expect(() => modelLogCompletionCommandSchema.parse(valid)).not.toThrow();
  });

  it("rejects invalid loggedAt strings", () => {
    const invalid: ModelLogCompletionCommand = {
      type: "log_completion",
      payload: {
        taskId: "task-bad-date",
        title: null,
        minutesSpent: 10,
        markDone: true,
        note: null,
        loggedAt: "2026-02-30T10:00:00Z",
      },
    };

    expect(() => modelLogCompletionCommandSchema.parse(invalid)).toThrow(/datetime/);
  });
});

describe("shrink_task rules", () => {
  it("allows zero remaining minutes", () => {
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

  it("rejects newRemainingMinutes greater than previousEstimateMinutes", () => {
    const invalid: ModelShrinkTaskCommand = {
      type: "shrink_task",
      payload: {
        taskId: "task-too-large",
        newRemainingMinutes: 90,
        previousEstimateMinutes: 60,
        reason: null,
      },
    };

    expect(() => modelShrinkTaskCommandSchema.parse(invalid)).toThrow(/previousEstimateMinutes/);
  });
});

describe("create_tasks specifics", () => {
  it("rejects empty task array", () => {
    const invalid = {
      type: "create_tasks",
      payload: { tasks: [], requestId: null },
    };

    expect(modelCreateTasksCommandSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects invalid due dates inside tasks", () => {
    const invalid = {
      type: "create_tasks",
      payload: {
        tasks: [
          {
            title: "Bad date",
            estimateMinutes: 30,
            dueDate: "2026-02-30",
            priority: "high",
            locked: false,
            note: null,
          },
        ],
        requestId: null,
      },
    };

    expect(modelCreateTasksCommandSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("add_urgent_task specifics", () => {
  it("rejects non-positive estimateMinutes", () => {
    const invalid: ModelAddUrgentTaskCommand = {
      type: "add_urgent_task",
      payload: {
        title: "Invalid estimate",
        estimateMinutes: 0,
        dueDate: "2026-03-15",
        priority: "urgent",
        windowDays: 3,
        note: null,
        reason: null,
      },
    };

    expect(() => modelAddUrgentTaskCommandSchema.parse(invalid)).toThrow();
  });

  it("rejects invalid dueDate", () => {
    const invalid: ModelAddUrgentTaskCommand = {
      type: "add_urgent_task",
      payload: {
        title: "Invalid date",
        estimateMinutes: 30,
        dueDate: "2026-02-30",
        priority: "urgent",
        windowDays: 3,
        note: null,
        reason: null,
      },
    };

    expect(() => modelAddUrgentTaskCommandSchema.parse(invalid)).toThrow(/calendar date/);
  });

  it("rejects non-positive windowDays", () => {
    const invalid: ModelAddUrgentTaskCommand = {
      type: "add_urgent_task",
      payload: {
        title: "Invalid window",
        estimateMinutes: 30,
        dueDate: "2026-03-15",
        priority: "urgent",
        windowDays: 0,
        note: null,
        reason: null,
      },
    };

    expect(() => modelAddUrgentTaskCommandSchema.parse(invalid)).toThrow();
  });
});

describe.skip("future guardrails", () => {
  it("could enforce payload size limits for model responses", () => {
    // placeholder for future constraints without changing current schema
  });
});
