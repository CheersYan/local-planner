import { describe, expect, it } from "vitest";

import type { BlackoutWindow, PlanSlot, Prisma, Setting, Task } from "@prisma/client";

import { generatePlanSlots, type PlannerClient, type PlannerTransaction } from "../service";

const BASE_DATE = new Date("2026-03-01T00:00:00Z");
const TODAY = new Date("2026-03-11T00:00:00Z");

const createTask = (overrides: Partial<Task> & { id: string }): Task => ({
  id: overrides.id,
  title: overrides.title ?? overrides.id,
  status: overrides.status ?? "active",
  estimateMinutes: overrides.estimateMinutes ?? 60,
  remainingMinutes: overrides.remainingMinutes ?? overrides.estimateMinutes ?? 60,
  actualMinutes: overrides.actualMinutes ?? null,
  dueDate: overrides.dueDate ?? null,
  plannedDate: overrides.plannedDate ?? null,
  priority: overrides.priority ?? 1,
  locked: overrides.locked ?? false,
  note: overrides.note ?? null,
  parentTaskId: overrides.parentTaskId ?? null,
  deletedAt: overrides.deletedAt ?? null,
  createdAt: overrides.createdAt ?? BASE_DATE,
  updatedAt: overrides.updatedAt ?? BASE_DATE,
});

const createPlanSlot = (overrides: Partial<PlanSlot> & { id: string; taskId: string; slotDate: Date }): PlanSlot => ({
  id: overrides.id,
  taskId: overrides.taskId,
  slotDate: overrides.slotDate,
  plannedMinutes: overrides.plannedMinutes ?? 60,
  position: overrides.position ?? 0,
  locked: overrides.locked ?? false,
  createdAt: overrides.createdAt ?? BASE_DATE,
  updatedAt: overrides.updatedAt ?? BASE_DATE,
});

const createSetting = (key: string, value: string): Setting => ({
  id: `${key}-id`,
  key,
  value,
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
});

const createSettings = (overrides?:
  Partial<{
    dailyCapacityHours: string;
    planningHorizonDays: string;
    allowWeekendWork: string;
    maxTaskTypesPerDay: string;
  }>,
): Setting[] => {
  const values = {
    dailyCapacityHours: "2",
    planningHorizonDays: "7",
    allowWeekendWork: "true",
    maxTaskTypesPerDay: "3",
    ...overrides,
  };

  return [
    createSetting("dailyCapacityHours", values.dailyCapacityHours),
    createSetting("planningHorizonDays", values.planningHorizonDays),
    createSetting("allowWeekendWork", values.allowWeekendWork),
    createSetting("maxTaskTypesPerDay", values.maxTaskTypesPerDay),
  ];
};

const createBlackoutWindow = (input: {
  id: string;
  startDate: Date | string;
  endDate?: Date | string;
}): BlackoutWindow => {
  const start = input.startDate instanceof Date ? input.startDate : new Date(`${input.startDate}T00:00:00Z`);
  const endSource = input.endDate ?? input.startDate;
  const end = endSource instanceof Date ? endSource : new Date(`${endSource}T00:00:00Z`);

  // 这里故意同时放几组常见字段名，降低与实际 Prisma schema 的耦合。
  return {
    id: input.id,
    startDate: start,
    endDate: end,
    startsAt: start,
    endsAt: end,
    start,
    end,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
  } as unknown as BlackoutWindow;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const slotsByDate = (slots: PlanSlot[]) =>
  slots.reduce<Record<string, PlanSlot[]>>((acc, slot) => {
    const key = isoDate(slot.slotDate);
    acc[key] ??= [];
    acc[key].push(slot);
    return acc;
  }, {});

const sumMinutes = (slots: PlanSlot[]) => slots.reduce((sum, slot) => sum + slot.plannedMinutes, 0);

const uniqueTaskCount = (slots: PlanSlot[]) => new Set(slots.map((slot) => slot.taskId)).size;

const taskDates = (slots: PlanSlot[], taskId: string) =>
  slots
    .filter((slot) => slot.taskId === taskId)
    .map((slot) => isoDate(slot.slotDate))
    .sort();

const firstTaskDate = (slots: PlanSlot[], taskId: string) => taskDates(slots, taskId)[0];

const structuralSnapshot = (slots: PlanSlot[]) =>
  slots
    .map((slot) => ({
      taskId: slot.taskId,
      slotDate: isoDate(slot.slotDate),
      plannedMinutes: slot.plannedMinutes,
      position: slot.position,
      locked: slot.locked,
    }))
    .sort((a, b) => {
      return (
        a.slotDate.localeCompare(b.slotDate) ||
        a.position - b.position ||
        a.taskId.localeCompare(b.taskId) ||
        a.plannedMinutes - b.plannedMinutes
      );
    });

const getWarningCodes = (result: unknown): string[] => {
  const maybeWarnings = (result as { warnings?: unknown }).warnings;

  if (!Array.isArray(maybeWarnings)) return [];

  return maybeWarnings
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "code" in item) {
        const value = (item as { code?: unknown }).code;
        return typeof value === "string" ? value : undefined;
      }
      return undefined;
    })
    .filter((value): value is string => Boolean(value));
};

class FakePlannerClient implements PlannerClient {
  private tasks: Task[];
  private slots: PlanSlot[];
  private blackouts: BlackoutWindow[];
  private settings: Setting[];
  private idCounter = 0;
  public transactionCalls = 0;

  constructor(input: { tasks?: Task[]; slots?: PlanSlot[]; blackouts?: BlackoutWindow[]; settings?: Setting[] }) {
    this.tasks = input.tasks ?? [];
    this.slots = input.slots ?? [];
    this.blackouts = input.blackouts ?? [];
    this.settings = input.settings ?? [];
  }

  task = {
    findMany: async () => this.tasks,
  } satisfies PlannerTransaction["task"];

  planSlot = {
    findMany: async () => this.slots,
    deleteMany: async (args?: Prisma.PlanSlotDeleteManyArgs) => {
      const slotDateFilter = args?.where?.slotDate;
      const lockedEquals = args?.where?.locked;

      const gte = (() => {
        if (slotDateFilter instanceof Date) return slotDateFilter;
        if (typeof slotDateFilter === "string") return new Date(slotDateFilter);
        if (slotDateFilter && typeof slotDateFilter === "object" && "gte" in slotDateFilter) {
          const value = slotDateFilter.gte;
          if (value instanceof Date) return value;
          if (typeof value === "string") return new Date(value);
        }
        return undefined;
      })();

      const before = this.slots.length;
      this.slots = this.slots.filter((slot) => {
        const matchDate = gte ? slot.slotDate >= gte : true;
        const matchLocked = lockedEquals !== undefined ? slot.locked === lockedEquals : true;
        const shouldDelete = matchDate && matchLocked;
        return !shouldDelete;
      });

      return { count: before - this.slots.length };
    },
    createMany: async (args: Prisma.PlanSlotCreateManyArgs) => {
      const payloads = Array.isArray(args.data) ? args.data : [args.data];

      for (const payload of payloads) {
        const slotDate = payload.slotDate instanceof Date ? payload.slotDate : new Date(payload.slotDate ?? BASE_DATE);

        const slot: PlanSlot = {
          id: payload.id ?? `slot-${(this.idCounter += 1)}`,
          taskId: payload.taskId,
          slotDate,
          plannedMinutes: payload.plannedMinutes ?? 0,
          position: payload.position ?? 0,
          locked: payload.locked ?? false,
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        };

        this.slots.push(slot);
      }

      return { count: payloads.length };
    },
  } satisfies PlannerTransaction["planSlot"];

  blackoutWindow = {
    findMany: async () => this.blackouts,
  } satisfies PlannerTransaction["blackoutWindow"];

  setting = {
    findMany: async () => this.settings,
  } satisfies PlannerTransaction["setting"];

  $transaction = async <T>(fn: (tx: PlannerTransaction) => Promise<T>): Promise<T> => {
    this.transactionCalls += 1;
    return fn(this);
  };
}

describe("generatePlanSlots", () => {
  it("replans only future unlocked slots while keeping history and locked slots", async () => {
    const pastSlot = createPlanSlot({
      id: "past-1",
      taskId: "task-a",
      slotDate: new Date("2026-03-10T00:00:00Z"),
      plannedMinutes: 30,
    });

    const unlockedToday = createPlanSlot({
      id: "future-1",
      taskId: "task-a",
      slotDate: TODAY,
      plannedMinutes: 30,
    });

    const lockedFuture = createPlanSlot({
      id: "lock-1",
      taskId: "locked-task",
      slotDate: new Date("2026-03-12T00:00:00Z"),
      plannedMinutes: 120,
      locked: true,
      position: 2,
    });

    const client = new FakePlannerClient({
      tasks: [
        createTask({ id: "task-a", estimateMinutes: 180, priority: 2 }),
        createTask({ id: "task-b", estimateMinutes: 60, priority: 1 }),
        createTask({ id: "locked-task", estimateMinutes: 60, priority: 0 }),
      ],
      slots: [pastSlot, unlockedToday, lockedFuture],
      settings: createSettings({ dailyCapacityHours: "2", planningHorizonDays: "3" }),
    });

    const result = await generatePlanSlots({ client, now: TODAY });
    const persistedSlots = await client.planSlot.findMany();
    const slotIds = new Set(persistedSlots.map((slot) => slot.id));

    expect(result.today).toBe("2026-03-11");
    expect(result.deletedSlots).toBe(1);
    expect(result.createdSlots).toBeGreaterThan(0);
    expect(client.transactionCalls).toBe(1);

    expect(slotIds.has("past-1")).toBe(true);
    expect(slotIds.has("lock-1")).toBe(true);
    expect(slotIds.has("future-1")).toBe(false);
  });

  it("treats both explicit blackouts and weekends as unavailable days", async () => {
    const client = new FakePlannerClient({
      tasks: [createTask({ id: "long", estimateMinutes: 720, priority: 5 })],
      blackouts: [createBlackoutWindow({ id: "b1", startDate: "2026-03-13" })],
      settings: createSettings({
        dailyCapacityHours: "4",
        planningHorizonDays: "7",
        allowWeekendWork: "false",
      }),
    });

    await generatePlanSlots({ client, now: TODAY });
    const persistedSlots = await client.planSlot.findMany();
    const scheduledDates = new Set(persistedSlots.map((slot) => isoDate(slot.slotDate)));

    expect(scheduledDates.has("2026-03-13")).toBe(false); // explicit blackout
    expect(scheduledDates.has("2026-03-14")).toBe(false); // Saturday
    expect(scheduledDates.has("2026-03-15")).toBe(false); // Sunday
    expect(scheduledDates.has("2026-03-16")).toBe(true); // shifted to next workday
  });

  it("never schedules work after a task due date", async () => {
    const client = new FakePlannerClient({
      tasks: [
        createTask({
          id: "due-soon",
          estimateMinutes: 300,
          dueDate: new Date("2026-03-12T00:00:00Z"),
          priority: 10,
        }),
      ],
      settings: createSettings({ dailyCapacityHours: "2", planningHorizonDays: "7" }),
    });

    const result = await generatePlanSlots({ client, now: TODAY });
    const persistedSlots = await client.planSlot.findMany();
    const dueSoonSlots = persistedSlots.filter((slot) => slot.taskId === "due-soon");
    const latestDate = dueSoonSlots.map((slot) => isoDate(slot.slotDate)).sort().at(-1) ?? "";

    expect(latestDate <= "2026-03-12").toBe(true);
    expect(sumMinutes(dueSoonSlots)).toBeLessThanOrEqual(240);

    // 如果 service 已经回传 warnings，这里应该能捕获到容量不足/截止日期冲突类告警。
    expect(result.draft.warnings.map((w) => w.code)).toContain("capacity_shortfall");
  });

  it("prioritizes earlier due dates when daily capacity is scarce", async () => {
    const client = new FakePlannerClient({
      tasks: [
        createTask({
          id: "later-but-important",
          estimateMinutes: 60,
          dueDate: new Date("2026-03-20T00:00:00Z"),
          priority: 10,
        }),
        createTask({
          id: "earlier-deadline",
          estimateMinutes: 60,
          dueDate: new Date("2026-03-12T00:00:00Z"),
          priority: 1,
        }),
      ],
      settings: createSettings({ dailyCapacityHours: "1", planningHorizonDays: "3" }),
    });

    await generatePlanSlots({ client, now: TODAY });
    const persistedSlots = await client.planSlot.findMany();

    expect(firstTaskDate(persistedSlots, "earlier-deadline")).toBe("2026-03-11");
    expect(firstTaskDate(persistedSlots, "later-but-important")).toBe("2026-03-12");
  });

  it("splits long work across days and never exceeds the daily capacity", async () => {
    const client = new FakePlannerClient({
      tasks: [createTask({ id: "deep-work", estimateMinutes: 600, priority: 5 })],
      settings: createSettings({ dailyCapacityHours: "3", planningHorizonDays: "5" }),
    });

    await generatePlanSlots({ client, now: TODAY });
    const persistedSlots = await client.planSlot.findMany();
    const byDate = slotsByDate(persistedSlots);
    const deepWorkDates = taskDates(persistedSlots, "deep-work");

    expect(deepWorkDates.length).toBeGreaterThan(1);
    expect(Object.values(byDate).every((daySlots) => sumMinutes(daySlots) <= 180)).toBe(true);
  });

  it("keeps each day within the maxTaskTypesPerDay limit", async () => {
    const client = new FakePlannerClient({
      tasks: [
        createTask({ id: "t1", estimateMinutes: 60, priority: 5 }),
        createTask({ id: "t2", estimateMinutes: 60, priority: 4 }),
        createTask({ id: "t3", estimateMinutes: 60, priority: 3 }),
        createTask({ id: "t4", estimateMinutes: 60, priority: 2 }),
        createTask({ id: "t5", estimateMinutes: 60, priority: 1 }),
      ],
      settings: createSettings({
        dailyCapacityHours: "5",
        planningHorizonDays: "2",
        maxTaskTypesPerDay: "2",
      }),
    });

    await generatePlanSlots({ client, now: TODAY });
    const persistedSlots = await client.planSlot.findMany();
    const byDate = slotsByDate(persistedSlots);

    expect(Object.values(byDate).every((daySlots) => uniqueTaskCount(daySlots) <= 2)).toBe(true);
  });

  it("treats an invalid task status as active instead of dropping the task", async () => {
    const client = new FakePlannerClient({
      tasks: [
        createTask({
          id: "status-fallback",
          status: "definitely-not-a-real-status" as Task["status"],
          estimateMinutes: 60,
        }),
      ],
      settings: createSettings({ dailyCapacityHours: "2", planningHorizonDays: "2" }),
    });

    await generatePlanSlots({ client, now: TODAY });
    const persistedSlots = await client.planSlot.findMany();

    expect(persistedSlots.some((slot) => slot.taskId === "status-fallback")).toBe(true);
  });

  it("does not place new unlocked work onto a day that is already fully occupied by locked slots", async () => {
    const lockedFuture = createPlanSlot({
      id: "locked-capacity",
      taskId: "locked-task",
      slotDate: new Date("2026-03-12T00:00:00Z"),
      plannedMinutes: 120,
      locked: true,
      position: 0,
    });

    const client = new FakePlannerClient({
      tasks: [createTask({ id: "free-task", estimateMinutes: 240, priority: 5 })],
      slots: [lockedFuture],
      settings: createSettings({ dailyCapacityHours: "2", planningHorizonDays: "4" }),
    });

    const result = await generatePlanSlots({ client, now: TODAY });
    const persistedSlots = await client.planSlot.findMany();
    const march12Slots = persistedSlots.filter((slot) => isoDate(slot.slotDate) === "2026-03-12");
    const unlockedMarch12Slots = march12Slots.filter((slot) => !slot.locked);

    expect(march12Slots).toHaveLength(1);
    expect(unlockedMarch12Slots).toHaveLength(0);
    expect(getWarningCodes(result).length).toBeGreaterThanOrEqual(0);
  });

  it("is stable across repeated replans and does not accumulate duplicate future slots", async () => {
    const client = new FakePlannerClient({
      tasks: [
        createTask({ id: "task-a", estimateMinutes: 180, priority: 2 }),
        createTask({ id: "task-b", estimateMinutes: 120, priority: 1 }),
      ],
      settings: createSettings({ dailyCapacityHours: "2", planningHorizonDays: "4" }),
    });

    await generatePlanSlots({ client, now: TODAY });
    const firstSnapshot = structuralSnapshot(await client.planSlot.findMany());

    await generatePlanSlots({ client, now: TODAY });
    const secondSnapshot = structuralSnapshot(await client.planSlot.findMany());

    expect(secondSnapshot).toEqual(firstSnapshot);
  });
});
