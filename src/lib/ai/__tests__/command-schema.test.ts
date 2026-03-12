import { describe, expect, it } from "vitest";

import {
  AddBlackoutCommand,
  AiCommand,
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
      minutesSpent: 45,
      note: "Shipped core logic",
      loggedAt: "2026-03-12T01:30:00Z",
    },
  },
  {
    type: "shrink_task",
    payload: {
      taskId: "task-abc",
      newEstimateMinutes: 60,
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
      payload: { minutesSpent: 30 },
    };

    expect(() => logCompletionCommandSchema.parse(invalid)).toThrow(/taskId or title/i);
  });

  it("requires shrink_task to actually shrink estimates when previousEstimateMinutes is provided", () => {
    const invalid: ShrinkTaskCommand = {
      type: "shrink_task",
      payload: {
        taskId: "task-xyz",
        newEstimateMinutes: 120,
        previousEstimateMinutes: 60,
      },
    };

    expect(() => shrinkTaskCommandSchema.parse(invalid)).toThrow(/smaller/i);
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
});
