import { describe, expect, it } from "vitest";

import {
  AddBlackoutCommand,
  AiCommand,
  aiCommandBatchSchema,
  aiCommandSchema,
  aiReadableContextSchema,
  LogCompletionCommand,
  ShrinkTaskCommand,
  addBlackoutCommandSchema,
  logCompletionCommandSchema,
  shrinkTaskCommandSchema,
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
];

describe("aiCommandSchema", () => {
  it("accepts the five command fixtures", () => {
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
          status: "planned",
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
      status: "planned",
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
          status: "planned",
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
});
