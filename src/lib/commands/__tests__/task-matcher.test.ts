import { describe, expect, it } from "vitest";

import type { Task } from "@prisma/client";

import { matchTask, TaskMatchError } from "../task-matcher";

const makeTask = (overrides: Partial<Task>): Task => ({
  id: overrides.id ?? "task-id",
  title: overrides.title ?? "Sample task",
  status: overrides.status ?? "active",
  estimateMinutes: overrides.estimateMinutes ?? 60,
  remainingMinutes: overrides.remainingMinutes ?? 60,
  actualMinutes: overrides.actualMinutes ?? 0,
  dueDate: overrides.dueDate ?? null,
  plannedDate: overrides.plannedDate ?? null,
  priority: overrides.priority ?? 1,
  locked: overrides.locked ?? false,
  note: overrides.note ?? null,
  parentTaskId: overrides.parentTaskId ?? null,
  deletedAt: overrides.deletedAt ?? null,
  createdAt: overrides.createdAt ?? new Date("2026-03-01T00:00:00Z"),
  updatedAt: overrides.updatedAt ?? new Date("2026-03-01T00:00:00Z"),
});

describe("matchTask", () => {
  it("matches taskId with highest priority", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Alpha" }),
      makeTask({ id: "t2", title: "Alpha" }),
    ];

    const hit = matchTask(tasks, { taskId: "t2" });
    expect(hit.id).toBe("t2");
  });

  it("matches normalized title exactly", () => {
    const tasks = [makeTask({ id: "t1", title: "产品 Demo" })];

    const hit = matchTask(tasks, { title: "产品 demo" });
    expect(hit.id).toBe("t1");
  });

  it("matches compact title when spacing differs", () => {
    const tasks = [makeTask({ id: "t1", title: "产品demo" })];

    const hit = matchTask(tasks, { title: "产品 demo" });
    expect(hit.id).toBe("t1");
  });

  it("ignores punctuation differences in titles", () => {
    const tasks = [makeTask({ id: "t1", title: "Roadmap（2026）" })];

    const hit = matchTask(tasks, { title: "roadmap 2026" });
    expect(hit.id).toBe("t1");
  });

  it("matches unique fuzzy locator by normalized contains", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Weekly report" }),
      makeTask({ id: "t2", title: "Refactor onboarding" }),
    ];

    const hit = matchTask(tasks, { fuzzyTitle: "weekly" });
    expect(hit.id).toBe("t1");
  });

  it("returns structured ambiguity when multiple fuzzy matches", () => {
    const tasks = [
      makeTask({ id: "t1", title: "销售报告" }),
      makeTask({ id: "t2", title: "销售复盘" }),
    ];

    expect(() => matchTask(tasks, { fuzzyTitle: "销售" })).toThrow(TaskMatchError);

    try {
      matchTask(tasks, { fuzzyTitle: "销售" });
    } catch (error) {
      const matchError = error as TaskMatchError;
      expect(matchError.code).toBe("ambiguous");
      expect(matchError.candidates).toHaveLength(2);
    }
  });

  it("ignores deleted tasks by default", () => {
    const tasks = [makeTask({ id: "t1", title: "Archived", deletedAt: new Date(), status: "archived" })];

    expect(() => matchTask(tasks, { title: "Archived" })).toThrow(TaskMatchError);

    try {
      matchTask(tasks, { title: "Archived" });
    } catch (error) {
      const matchError = error as TaskMatchError;
      expect(matchError.code).toBe("not_found");
      expect(matchError.candidates).toHaveLength(0);
    }
  });

  it("allows restore-style lookup to include deleted tasks with preference", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Restore me", status: "active" }),
      makeTask({ id: "t2", title: "Restore me", status: "archived", deletedAt: new Date("2026-03-10T00:00:00Z") }),
    ];

    const hit = matchTask(tasks, { title: "Restore me" }, {
      includeDeleted: true,
      statusPreference: ["archived", "active"],
    });

    expect(hit.id).toBe("t2");
  });

  it("prioritizes completed tasks when reopening with includeDeleted", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Finish docs", status: "completed" }),
      makeTask({ id: "t2", title: "Finish docs", status: "archived", deletedAt: new Date("2026-03-11T00:00:00Z") }),
    ];

    const hit = matchTask(tasks, { fuzzyTitle: "finish docs" }, {
      includeDeleted: true,
      statusPreference: ["completed", "archived", "active"],
    });

    expect(hit.id).toBe("t1");
  });
});
