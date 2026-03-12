import { describe, expect, it } from "vitest";

import { aiCommandBatchSchema } from "../command-schema";
import {
  ModelAddBlackoutCommand,
  ModelAddUrgentTaskCommand,
  ModelAiCommandEnvelope,
  ModelCreateTasksCommand,
  ModelLogCompletionCommand,
  ModelShrinkTaskCommand,
} from "../model-command-schema";
import {
  normalizeModelCommandForTest,
  normalizeModelEnvelope,
} from "../model-normalizer";

describe("normalizeModelCommandForTest", () => {
  describe("create_tasks", () => {
    it("maps priority enums and cleans nullable fields", () => {
      const command: ModelCreateTasksCommand = {
        type: "create_tasks",
        payload: {
          tasks: [
            {
              title: "low priority task",
              estimateMinutes: 15,
              dueDate: null,
              priority: "low",
              locked: false,
              note: null,
            },
            {
              title: "medium priority task",
              estimateMinutes: 20,
              dueDate: null,
              priority: "medium",
              locked: false,
              note: null,
            },
            {
              title: "high priority task",
              estimateMinutes: 25,
              dueDate: null,
              priority: "high",
              locked: false,
              note: null,
            },
            {
              title: "urgent priority task",
              estimateMinutes: 30,
              dueDate: null,
              priority: "urgent",
              locked: false,
              note: null,
            },
          ],
          requestId: null,
        },
      };

      expect(normalizeModelCommandForTest(command)).toEqual({
        type: "create_tasks",
        payload: {
          tasks: [
            {
              title: "low priority task",
              estimateMinutes: 15,
              dueDate: undefined,
              priority: 1,
              locked: false,
              note: undefined,
            },
            {
              title: "medium priority task",
              estimateMinutes: 20,
              dueDate: undefined,
              priority: 2,
              locked: false,
              note: undefined,
            },
            {
              title: "high priority task",
              estimateMinutes: 25,
              dueDate: undefined,
              priority: 3,
              locked: false,
              note: undefined,
            },
            {
              title: "urgent priority task",
              estimateMinutes: 30,
              dueDate: undefined,
              priority: 10,
              locked: false,
              note: undefined,
            },
          ],
          requestId: undefined,
        },
      });
    });
  });

  describe("log_completion", () => {
    it("cleans nullable fields while keeping markDone true", () => {
      const command: ModelLogCompletionCommand = {
        type: "log_completion",
        payload: {
          taskId: "task-1",
          title: null,
          minutesSpent: null,
          markDone: true,
          note: null,
          loggedAt: null,
        },
      };

      expect(normalizeModelCommandForTest(command)).toEqual({
        type: "log_completion",
        payload: {
          taskId: "task-1",
          title: undefined,
          minutesSpent: undefined,
          markDone: true,
          note: undefined,
          loggedAt: undefined,
        },
      });
    });

    it("keeps markDone false and removes nullable extras", () => {
      const command: ModelLogCompletionCommand = {
        type: "log_completion",
        payload: {
          taskId: null,
          title: "Loose chore",
          minutesSpent: 25,
          markDone: false,
          note: null,
          loggedAt: "2026-03-12T00:00:00Z",
        },
      };

      expect(normalizeModelCommandForTest(command)).toEqual({
        type: "log_completion",
        payload: {
          taskId: undefined,
          title: "Loose chore",
          minutesSpent: 25,
          markDone: false,
          note: undefined,
          loggedAt: "2026-03-12T00:00:00Z",
        },
      });
    });
  });

  describe("shrink_task", () => {
    it("keeps newRemainingMinutes and drops nullable previousEstimateMinutes", () => {
      const command: ModelShrinkTaskCommand = {
        type: "shrink_task",
        payload: {
          taskId: "task-shrink",
          newRemainingMinutes: 15,
          previousEstimateMinutes: null,
          reason: null,
        },
      };

      expect(normalizeModelCommandForTest(command)).toEqual({
        type: "shrink_task",
        payload: {
          taskId: "task-shrink",
          newRemainingMinutes: 15,
          previousEstimateMinutes: undefined,
          reason: undefined,
        },
      });
    });
  });

  describe("add_blackout", () => {
    it("converts dates into whole-day blackout window", () => {
      const command: ModelAddBlackoutCommand = {
        type: "add_blackout",
        payload: {
          startDate: "2026-03-20",
          endDate: "2026-03-21",
          reason: "Offsite",
        },
      };

      expect(normalizeModelCommandForTest(command)).toEqual({
        type: "add_blackout",
        payload: {
          start: "2026-03-20T00:00:00Z",
          end: "2026-03-21T23:59:59Z",
          reason: "Offsite",
        },
      });
    });
  });

  describe("add_urgent_task", () => {
    it("maps priority, forces unlocked, and cleans nullable note/reason", () => {
      const command: ModelAddUrgentTaskCommand = {
        type: "add_urgent_task",
        payload: {
          title: "Fix blocking bug",
          estimateMinutes: 60,
          dueDate: "2026-03-18",
          priority: "urgent",
          windowDays: 2,
          note: null,
          reason: null,
        },
      };

      expect(normalizeModelCommandForTest(command)).toEqual({
        type: "add_urgent_task",
        payload: {
          title: "Fix blocking bug",
          estimateMinutes: 60,
          dueDate: "2026-03-18",
          priority: 10,
          windowDays: 2,
          locked: false,
          note: undefined,
          reason: undefined,
        },
      });
    });
  });
});

describe("normalizeModelEnvelope", () => {
  it("returns batches accepted by aiCommandBatchSchema", () => {
    const envelope: ModelAiCommandEnvelope = {
      commands: [
        {
          type: "create_tasks",
          payload: {
            tasks: [
              {
                title: "New task",
                estimateMinutes: 30,
                dueDate: null,
                priority: "low",
                locked: false,
                note: null,
              },
            ],
            requestId: null,
          },
        },
      ],
    };

    const batch = normalizeModelEnvelope(envelope);
    expect(() => aiCommandBatchSchema.parse(batch)).not.toThrow();
  });

  it("throws for envelopes that fail validation", () => {
    const invalidEnvelope = {
      commands: [{ type: "create_tasks", payload: { tasks: [], requestId: null } }],
    } as unknown as ModelAiCommandEnvelope;

    expect(() => normalizeModelEnvelope(invalidEnvelope)).toThrow();
  });
});
