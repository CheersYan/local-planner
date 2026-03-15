import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { executeCommandBatch } from "../executor";
import { generatePlanSlots } from "@/lib/planner/service";

const TODAY = new Date("2026-03-11T00:00:00Z");

const createTask = (overrides: Partial<Parameters<typeof prisma.task.create>[0]["data"]> = {}) =>
  prisma.task.create({
    data: {
      title: overrides.title ?? "Long task",
      status: overrides.status ?? "active",
      estimateMinutes: overrides.estimateMinutes ?? 960,
      remainingMinutes: overrides.remainingMinutes ?? overrides.estimateMinutes ?? 960,
      priority: overrides.priority ?? 5,
      dueDate: overrides.dueDate ?? null,
      plannedDate: overrides.plannedDate ?? null,
      locked: overrides.locked ?? false,
      note: overrides.note ?? null,
      parentTaskId: overrides.parentTaskId ?? null,
    },
  });

const createBlackout = (overrides: Partial<Parameters<typeof prisma.blackoutWindow.create>[0]["data"]> = {}) =>
  prisma.blackoutWindow.create({
    data: {
      start: overrides.start ?? new Date("2026-03-12T00:00:00Z"),
      end: overrides.end ?? new Date("2026-03-12T23:59:59Z"),
      reason: overrides.reason ?? "Trip",
    },
  });

const slotDatesForTask = async (taskId: string): Promise<string[]> => {
  const slots = await prisma.planSlot.findMany({ where: { taskId } });
  return slots
    .map((slot) => slot.slotDate.toISOString().slice(0, 10))
    .sort();
};

const snapshotSlots = async (): Promise<Array<{ taskId: string; date: string; minutes: number; position: number }>> => {
  const slots = await prisma.planSlot.findMany({
    orderBy: [
      { slotDate: "asc" },
      { position: "asc" },
      { taskId: "asc" },
    ],
  });
  return slots.map((slot) => ({
    taskId: slot.taskId,
    date: slot.slotDate.toISOString(),
    minutes: slot.plannedMinutes,
    position: slot.position,
  }));
};

describe("blackout commands with planner integration", () => {
  beforeEach(async () => {
    await prisma.planSlot.deleteMany();
    await prisma.completionLog.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.task.deleteMany();
    await prisma.blackoutWindow.deleteMany();
  });

  it("replans when blackout is moved later, freeing the previously blocked day", async () => {
    const task = await createTask();
    const blackout = await createBlackout({ start: new Date("2026-03-12T00:00:00Z"), end: new Date("2026-03-12T23:59:59Z") });

    await generatePlanSlots({ now: TODAY });
    const beforeDates = await slotDatesForTask(task.id);
    expect(beforeDates).toContain("2026-03-11");
    expect(beforeDates).toContain("2026-03-13");
    expect(beforeDates).not.toContain("2026-03-12");

    await executeCommandBatch(
      [
        {
          type: "update_blackout_window",
          payload: { target: { blackoutId: blackout.id }, startDate: "2026-03-13", endDate: "2026-03-13" },
        },
      ],
      { now: TODAY },
    );

    const afterDates = await slotDatesForTask(task.id);
    expect(afterDates).toContain("2026-03-12");
    expect(afterDates).not.toContain("2026-03-13");
  });

  it("pushes work later when blackout window expands", async () => {
    const task = await createTask();
    const blackout = await createBlackout({ start: new Date("2026-03-12T00:00:00Z"), end: new Date("2026-03-12T23:59:59Z") });

    await generatePlanSlots({ now: TODAY });
    const beforeDates = await slotDatesForTask(task.id);
    expect(beforeDates).toContain("2026-03-13");

    await executeCommandBatch(
      [
        {
          type: "update_blackout_window",
          payload: { target: { blackoutId: blackout.id }, startDate: "2026-03-12", endDate: "2026-03-13" },
        },
      ],
      { now: TODAY },
    );

    const afterDates = await slotDatesForTask(task.id);
    expect(afterDates).not.toContain("2026-03-13");
    expect(afterDates).toContain("2026-03-16"); // weekend skipped, shifted to next workday
  });

  it("keeps plan slots stable when only blackout reason changes", async () => {
    await createTask({ estimateMinutes: 480, remainingMinutes: 480 });
    const blackout = await createBlackout({ reason: "Maintenance" });

    await generatePlanSlots({ now: TODAY });
    const beforeSlots = await snapshotSlots();

    const result = await executeCommandBatch(
      [
        {
          type: "update_blackout_window",
          payload: { target: { blackoutId: blackout.id }, reason: "Maintenance (updated)" },
        },
      ],
      { now: TODAY },
    );

    const afterSlots = await snapshotSlots();
    const updatedBlackout = await prisma.blackoutWindow.findUniqueOrThrow({ where: { id: blackout.id } });

    expect(result.replanTriggered).toBe(false);
    expect(afterSlots).toEqual(beforeSlots);
    expect(updatedBlackout.reason).toBe("Maintenance (updated)");
  });
});
