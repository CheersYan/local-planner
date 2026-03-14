import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import * as plannerService from "@/lib/planner/service";
import { executeCommandBatch } from "../executor";
import type { AiCommandBatch } from "@/lib/ai/command-schema";
import type { PlannerServiceResult } from "@/lib/planner/service";

const mockReplan = vi.spyOn(plannerService, "generatePlanSlots");

const emptyPlannerResult: PlannerServiceResult = {
  today: "2026-03-14",
  draft: {
    frozenSlots: [],
    proposedSlots: [],
    unassignedTaskIds: [],
    warnings: [],
    appliedOptions: {
      lookaheadDays: 7,
      slotMinutes: 60,
      dailyCapacityHours: 8,
      maxTaskTypesPerDay: 3,
    },
  },
  createdSlots: 0,
  deletedSlots: 0,
};

const createTask = (overrides: Partial<Parameters<typeof prisma.task.create>[0]["data"]> = {}) =>
  prisma.task.create({
    data: {
      title: overrides.title ?? "Task",
      status: overrides.status ?? "active",
      estimateMinutes: overrides.estimateMinutes ?? 60,
      remainingMinutes: overrides.remainingMinutes ?? overrides.estimateMinutes ?? 60,
      actualMinutes: overrides.actualMinutes ?? 0,
      priority: overrides.priority ?? 1,
      dueDate: overrides.dueDate ?? null,
      plannedDate: overrides.plannedDate ?? null,
      locked: overrides.locked ?? false,
      note: overrides.note ?? null,
      parentTaskId: overrides.parentTaskId ?? null,
    },
  });

beforeEach(async () => {
  await prisma.planSlot.deleteMany();
  await prisma.completionLog.deleteMany();
  await prisma.task.deleteMany();
  mockReplan.mockReset();
  mockReplan.mockResolvedValue(emptyPlannerResult);
});

describe("executeCommandBatch", () => {
  it("updates task fields and triggers replan for estimate change", async () => {
    const task = await createTask({ title: "Demo", estimateMinutes: 60, remainingMinutes: 60, priority: 1 });
    const batch: AiCommandBatch = [
      {
        type: "update_task_fields",
        payload: {
          target: { taskId: task.id },
          title: "产品 demo",
          estimateMinutes: 120,
          remainingMinutes: 90,
          dueDate: "2026-03-28",
          priority: 3,
          note: "updated",
        },
      },
    ];

    const result = await executeCommandBatch(batch, { now: new Date("2026-03-14T00:00:00Z") });
    expect(result.replanTriggered).toBe(true);
    expect(mockReplan).toHaveBeenCalled();
    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.title).toBe("产品 demo");
    expect(updated.estimateMinutes).toBe(120);
    expect(updated.remainingMinutes).toBe(90);
    expect(updated.dueDate?.toISOString().slice(0, 10)).toBe("2026-03-28");
    expect(updated.priority).toBe(3);
    expect(updated.note).toBe("updated");
  });

  it("pauses and resumes tasks and cleans future plan slots", async () => {
    const task = await createTask({ title: "Pause me" });
    await prisma.planSlot.create({
      data: {
        taskId: task.id,
        slotDate: new Date("2026-03-15T00:00:00Z"),
        plannedMinutes: 60,
        position: 0,
        locked: false,
      },
    });

    const pauseBatch: AiCommandBatch = [{ type: "pause_task", payload: { target: { taskId: task.id }, reason: "blocked" } }];
    await executeCommandBatch(pauseBatch, { now: new Date("2026-03-14T00:00:00Z") });
    const paused = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(paused.status).toBe("paused");
    const slotsAfterPause = await prisma.planSlot.findMany({ where: { taskId: task.id } });
    expect(slotsAfterPause.length).toBe(0);

    const resumeBatch: AiCommandBatch = [{ type: "resume_task", payload: { target: { taskId: task.id } } }];
    await executeCommandBatch(resumeBatch, { now: new Date("2026-03-14T00:00:00Z") });
    const resumed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(resumed.status).toBe("active");
    expect(mockReplan).toHaveBeenCalledTimes(2);
  });

  it("soft deletes and restores tasks", async () => {
    const task = await createTask({ title: "Soft delete" });
    const delBatch: AiCommandBatch = [{ type: "delete_task", payload: { target: { taskId: task.id } } }];
    await executeCommandBatch(delBatch, { now: new Date("2026-03-14T00:00:00Z") });
    const deleted = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(deleted.status).toBe("archived");
    expect(deleted.deletedAt).not.toBeNull();

    const restoreBatch: AiCommandBatch = [{ type: "restore_task", payload: { target: { taskId: task.id } } }];
    await executeCommandBatch(restoreBatch, { now: new Date("2026-03-14T00:00:00Z") });
    const restored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(restored.status).toBe("active");
    expect(restored.deletedAt).toBeNull();
  });

  it("marks tasks done and reopens with required remaining minutes", async () => {
    const task = await createTask({ title: "Doc cleanup", remainingMinutes: 30 });
    await executeCommandBatch(
      [{ type: "mark_task_done", payload: { target: { taskId: task.id }, note: null } }],
      { now: new Date("2026-03-14T00:00:00Z") },
    );
    const done = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(done.status).toBe("completed");
    expect(done.remainingMinutes).toBe(0);

    await executeCommandBatch(
      [{ type: "reopen_task", payload: { target: { taskId: task.id }, remainingMinutes: 120, note: null } }],
      { now: new Date("2026-03-14T00:00:00Z") },
    );
    const reopened = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(reopened.status).toBe("active");
    expect(reopened.remainingMinutes).toBe(120);
  });

  it("splits a task into children and archives the original", async () => {
    const task = await createTask({ title: "Parent", estimateMinutes: 180, remainingMinutes: 180, priority: 2, dueDate: new Date("2026-03-30T00:00:00Z") });
    const batch: AiCommandBatch = [
      {
        type: "split_task",
        payload: {
          target: { taskId: task.id },
          parts: [
            { title: "Part1", estimateMinutes: 60 },
            { title: "Part2", estimateMinutes: 120 },
          ],
          reason: "Breakdown",
        },
      },
    ];

    const result = await executeCommandBatch(batch, { now: new Date("2026-03-14T00:00:00Z") });
    expect(result.results[0].created?.length).toBe(2);
    const archived = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(archived.status).toBe("archived");
    const children = await prisma.task.findMany({ where: { parentTaskId: task.id } });
    expect(children.map((c) => c.title)).toEqual(["Part1", "Part2"]);
  });

  it("merges tasks, archives originals, and sums remaining hours", async () => {
    const taskA = await createTask({ title: "Task A", remainingMinutes: 60, priority: 1, dueDate: new Date("2026-03-20T00:00:00Z") });
    const taskB = await createTask({ title: "Task B", remainingMinutes: 120, priority: 3, dueDate: new Date("2026-03-25T00:00:00Z") });

    const batch: AiCommandBatch = [
      {
        type: "merge_tasks",
        payload: {
          targets: [{ taskId: taskA.id }, { taskId: taskB.id }],
          title: "Merged",
          remainingMinutes: undefined,
          estimateMinutes: undefined,
          dueDate: undefined,
          priority: undefined,
          note: undefined,
        },
      },
    ];

    const result = await executeCommandBatch(batch, { now: new Date("2026-03-14T00:00:00Z") });
    expect(result.results[0].created?.[0].title).toBe("Merged");
    const merged = await prisma.task.findFirstOrThrow({ where: { title: "Merged" } });
    expect(merged.remainingMinutes).toBe(180);
    expect(merged.priority).toBe(3);
    expect(merged.dueDate?.toISOString().slice(0, 10)).toBe("2026-03-25");

    const archived = await prisma.task.findMany({ where: { status: "archived" } });
    expect(archived).toHaveLength(2);
  });

  it("returns an error when fuzzy title is ambiguous", async () => {
    await createTask({ title: "报告A" });
    await createTask({ title: "报告B" });

    const batch: AiCommandBatch = [
      {
        type: "update_task_fields",
        payload: {
          target: { taskId: undefined, title: undefined, fuzzyTitle: "报告" },
          title: "new",
        },
      },
    ];

    const result = await executeCommandBatch(batch, { now: new Date("2026-03-14T00:00:00Z") });
    expect(result.results[0].status).toBe("error");
    expect(result.results[0].message).toMatch(/ambiguous/i);
  });
});
