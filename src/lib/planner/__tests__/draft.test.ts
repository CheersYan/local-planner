import { describe, expect, it } from "vitest";

import { draftPlan } from "../draft";
import { PlannerBlackout, PlannerSlot, PlannerSnapshot, PlannerTask } from "../types";

type SnapshotInput = Partial<PlannerSnapshot> & {
  tasks?: PlannerTask[];
  planSlots?: PlannerSlot[];
  blackoutWindows?: PlannerBlackout[];
};

const createTask = (overrides: Partial<PlannerTask> & { id: string }): PlannerTask => ({
  id: overrides.id,
  title: overrides.title ?? overrides.id,
  status: overrides.status ?? "active",
  estimateMinutes: overrides.estimateMinutes ?? 60,
  actualMinutes: overrides.actualMinutes,
  dueDate: overrides.dueDate,
  plannedDate: overrides.plannedDate,
  priority: overrides.priority ?? 1,
  locked: overrides.locked ?? false,
});

const createSlot = (overrides: Partial<PlannerSlot> & { id: string; taskId: string; slotDate: string }): PlannerSlot => ({
  id: overrides.id,
  taskId: overrides.taskId,
  slotDate: overrides.slotDate,
  plannedMinutes: overrides.plannedMinutes ?? 60,
  position: overrides.position ?? 0,
  locked: overrides.locked ?? false,
});

const buildSnapshot = (input: SnapshotInput): PlannerSnapshot => ({
  today: input.today ?? "2026-03-11",
  tasks: input.tasks ?? [],
  planSlots: input.planSlots ?? [],
  blackoutWindows: input.blackoutWindows ?? [],
  goals: input.goals ?? [],
  inbox: input.inbox ?? [],
});

const groupSlotsByDate = (slots: PlannerSlot[]): Map<string, PlannerSlot[]> => {
  const grouped = new Map<string, PlannerSlot[]>();

  for (const slot of slots) {
    const current = grouped.get(slot.slotDate) ?? [];
    current.push(slot);
    grouped.set(slot.slotDate, current);
  }

  return grouped;
};

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

describe("draftPlan", () => {
  it("mixes long tasks with other tasks on the same day", () => {
    // 长任务同天混排：长任务被拆成多段，并与其他任务在同一天交错出现。
    const snapshot = buildSnapshot({
      tasks: [
        createTask({ id: "long", estimateMinutes: 240, priority: 5 }),
        createTask({ id: "short1", estimateMinutes: 120, priority: 4 }),
        createTask({ id: "short2", estimateMinutes: 120, priority: 3 }),
      ],
    });

    const draft = draftPlan(snapshot, { slotMinutes: 60, dailyCapacityHours: 8 });

    const todaysSlots = draft.proposedSlots.filter((slot) => slot.slotDate === snapshot.today);
    const firstThreeIds = todaysSlots.slice(0, 3).map((slot) => slot.taskId);

    expect(todaysSlots.filter((slot) => slot.taskId === "long")).toHaveLength(4);
    expect(new Set(firstThreeIds)).toStrictEqual(new Set(["long", "short1", "short2"]));
  });

  it("limits how many task types can appear in a single day", () => {
    // 单日任务种类上限：超过上限的任务应顺延到下一天。
    const snapshot = buildSnapshot({
      tasks: [
        createTask({ id: "task-a", estimateMinutes: 60, priority: 3 }),
        createTask({ id: "task-b", estimateMinutes: 60, priority: 2 }),
        createTask({ id: "task-c", estimateMinutes: 60, priority: 1 }),
      ],
    });

    const draft = draftPlan(snapshot, {
      maxTaskTypesPerDay: 2,
      lookaheadDays: 2,
      dailyCapacityHours: 3,
      slotMinutes: 60,
    });

    const slotsByDate = groupSlotsByDate(draft.proposedSlots);
    const todaySlots = slotsByDate.get(snapshot.today)?.map((slot) => slot.taskId).sort();
    const tomorrowSlots = slotsByDate.get(addDays(snapshot.today, 1))?.map((slot) => slot.taskId).sort();

    expect(todaySlots).toEqual(["task-a", "task-b"]);
    expect(tomorrowSlots).toEqual(["task-c"]);
  });

  it("treats due dates as a hard cap and reports the unplaced remainder", () => {
    // due date 硬约束：不可排到截止日之后，剩余部分要被报告为短缺。
    const snapshot = buildSnapshot({
      tasks: [
        createTask({ id: "due-soon", estimateMinutes: 300, dueDate: "2026-03-12", priority: 5 }),
      ],
    });

    const draft = draftPlan(snapshot, { dailyCapacityHours: 2, lookaheadDays: 5, slotMinutes: 60 });

    expect(draft.proposedSlots.every((slot) => slot.slotDate <= "2026-03-12")).toBe(true);
    expect(draft.proposedSlots.reduce((sum, slot) => sum + slot.plannedMinutes, 0)).toBe(240);
    expect(draft.unassignedTaskIds).toContain("due-soon");

    const shortfall = draft.warnings.find((warning) => warning.code === "capacity_shortfall");
    expect(shortfall?.details).toMatchObject({
      taskIds: ["due-soon"],
      shortfalls: expect.arrayContaining([
        expect.objectContaining({
          taskId: "due-soon",
          minutesUnassigned: 60,
          reason: "due_date",
          dueDate: "2026-03-12",
        }),
      ]),
    });
  });

  it("skips blackout dates and warns about locked slots that collide", () => {
    // blackout：黑名单日期不应被新 slot 使用，被锁定的冲突 slot 需要提醒。
    const blackout: PlannerBlackout = {
      id: "bo-1",
      start: "2026-03-12T00:00:00Z",
      end: "2026-03-12T23:59:00Z",
      reason: "out of office",
    };

    const lockedSlot = createSlot({
      id: "locked-slot",
      taskId: "locked-task",
      slotDate: "2026-03-12",
      plannedMinutes: 60,
      position: 0,
      locked: true,
    });

    const snapshot = buildSnapshot({
      tasks: [
        createTask({ id: "normal", estimateMinutes: 120, priority: 2 }),
        createTask({ id: "locked-task", estimateMinutes: 60, priority: 1 }),
      ],
      planSlots: [lockedSlot],
      blackoutWindows: [blackout],
    });

    const draft = draftPlan(snapshot, { slotMinutes: 60, dailyCapacityHours: 4 });

    expect(draft.proposedSlots.every((slot) => slot.slotDate !== "2026-03-12")).toBe(true);
    expect(draft.frozenSlots).toContainEqual(lockedSlot);

    const blackoutWarning = draft.warnings.find((warning) => warning.code === "locked_overflow");
    expect(blackoutWarning?.details).toMatchObject({
      taskIds: ["locked-task"],
      slotIds: ["locked-slot"],
      dates: ["2026-03-12"],
    });
  });

  it("surfaces locked slots that sit outside the current lookahead window", () => {
    // outside lookahead：超出窗口的锁定 slot 保留不动且触发提醒。
    const lockedFuture = createSlot({
      id: "far-lock",
      taskId: "far-task",
      slotDate: "2026-03-25",
      plannedMinutes: 60,
      position: 0,
      locked: true,
    });

    const snapshot = buildSnapshot({
      tasks: [createTask({ id: "far-task", estimateMinutes: 60 })],
      planSlots: [lockedFuture],
    });

    const draft = draftPlan(snapshot, { lookaheadDays: 7 });

    expect(draft.frozenSlots).toContainEqual(lockedFuture);

    const lookaheadWarning = draft.warnings.find((warning) => warning.code === "outside_lookahead");
    expect(lookaheadWarning?.details).toMatchObject({
      taskIds: ["far-task"],
      slotIds: ["far-lock"],
      dates: ["2026-03-25"],
    });
  });

  it("keeps new slots after the highest locked position on that date", () => {
    // locked slot position 不冲突：新 slot 的 position 应从已锁定的最高位置之后开始。
    const lockedSlot = createSlot({
      id: "locked-pos",
      taskId: "locked",
      slotDate: "2026-03-11",
      plannedMinutes: 60,
      position: 2,
      locked: true,
    });

    const snapshot = buildSnapshot({
      tasks: [
        createTask({ id: "locked", estimateMinutes: 60, priority: 2 }),
        createTask({ id: "new-task", estimateMinutes: 120, priority: 1 }),
      ],
      planSlots: [lockedSlot],
    });

    const draft = draftPlan(snapshot, { slotMinutes: 60, dailyCapacityHours: 4 });

    const newSlots = draft.proposedSlots.filter((slot) => slot.slotDate === snapshot.today);

    expect(newSlots).not.toHaveLength(0);
    expect(newSlots.every((slot) => slot.position > lockedSlot.position)).toBe(true);

    const positionsOnDate = [
      ...draft.frozenSlots.filter((slot) => slot.slotDate === snapshot.today).map((slot) => slot.position),
      ...newSlots.map((slot) => slot.position),
    ];

    expect(new Set(positionsOnDate).size).toBe(positionsOnDate.length);
  });

  it("does not reuse past days and keeps historical slots frozen", () => {
    // 过去的 slot 应被冻结，排期不能回写历史日期。
    const pastSlot = createSlot({
      id: "past-slot",
      taskId: "done-task",
      slotDate: "2026-03-10",
      plannedMinutes: 60,
      position: 0,
      locked: false,
    });

    const snapshot = buildSnapshot({
      tasks: [
        createTask({ id: "done-task", status: "completed", estimateMinutes: 60 }),
        createTask({ id: "fresh", estimateMinutes: 120 }),
      ],
      planSlots: [pastSlot],
    });

    const draft = draftPlan(snapshot, { slotMinutes: 60 });

    expect(draft.frozenSlots).toContainEqual(pastSlot);
    expect(draft.proposedSlots.every((slot) => slot.slotDate >= snapshot.today)).toBe(true);
  });

  it("never exceeds daily capacity when allocating slots", () => {
    // 每日容量约束：任意日期的总分钟数不得超过 dailyCapacityHours。
    const snapshot = buildSnapshot({
      tasks: [
        createTask({ id: "task-1", estimateMinutes: 400, priority: 5 }),
        createTask({ id: "task-2", estimateMinutes: 400, priority: 4 }),
      ],
    });

    const draft = draftPlan(snapshot, { dailyCapacityHours: 8, slotMinutes: 60, lookaheadDays: 3 });

    const slotsByDate = groupSlotsByDate(draft.proposedSlots);
    for (const [, slots] of slotsByDate) {
      const total = slots.reduce((sum, slot) => sum + slot.plannedMinutes, 0);
      expect(total).toBeLessThanOrEqual(8 * 60);
    }
  });

  it("subtracts locked minutes for a task before proposing new work", () => {
    // 已锁定分钟数应该抵扣剩余估时，避免重复分配。
    const lockedSlot = createSlot({
      id: "lock-keep",
      taskId: "shared",
      slotDate: "2026-03-11",
      plannedMinutes: 180,
      position: 0,
      locked: true,
    });

    const snapshot = buildSnapshot({
      tasks: [createTask({ id: "shared", estimateMinutes: 240, priority: 3 })],
      planSlots: [lockedSlot],
    });

    const draft = draftPlan(snapshot, { slotMinutes: 60, dailyCapacityHours: 8 });

    const proposedForTask = draft.proposedSlots.filter((slot) => slot.taskId === "shared");
    expect(proposedForTask.reduce((sum, slot) => sum + slot.plannedMinutes, 0)).toBe(60);
    expect(draft.frozenSlots).toContainEqual(lockedSlot);
  });

  it("warns when locked work sits after a task's due date", () => {
    // due_date_locked_conflict：锁定 slot 晚于截止日需提醒且视为未排完。
    const lockedAfterDue = createSlot({
      id: "late-lock",
      taskId: "due-task",
      slotDate: "2026-03-15",
      plannedMinutes: 60,
      position: 0,
      locked: true,
    });

    const snapshot = buildSnapshot({
      tasks: [createTask({ id: "due-task", estimateMinutes: 120, dueDate: "2026-03-12", priority: 5 })],
      planSlots: [lockedAfterDue],
    });

    const draft = draftPlan(snapshot, { lookaheadDays: 7 });

    expect(draft.unassignedTaskIds).toContain("due-task");
    const warning = draft.warnings.find((item) => item.code === "capacity_shortfall");
    expect(warning?.details).toMatchObject({
      taskIds: ["due-task"],
      shortfalls: expect.arrayContaining([
        expect.objectContaining({
          taskId: "due-task",
          minutesUnassigned: 60,
          reason: "due_date_locked_conflict",
          dueDate: "2026-03-12",
        }),
      ]),
    });
  });

  it("counts locked task types toward the daily type limit", () => {
    // 单日种类上限应包含已锁定的任务类型。
    const lockedToday = createSlot({
      id: "lock-today",
      taskId: "locked-a",
      slotDate: "2026-03-11",
      plannedMinutes: 60,
      position: 0,
      locked: true,
    });

    const snapshot = buildSnapshot({
      tasks: [
        createTask({ id: "locked-a", estimateMinutes: 60 }),
        createTask({ id: "free-b", estimateMinutes: 60 }),
        createTask({ id: "free-c", estimateMinutes: 60 }),
      ],
      planSlots: [lockedToday],
    });

    const draft = draftPlan(snapshot, { maxTaskTypesPerDay: 2, slotMinutes: 60, lookaheadDays: 2 });
    const slotsByDate = groupSlotsByDate(draft.proposedSlots);

    const todayTaskIds = new Set([
      ...draft.frozenSlots.filter((slot) => slot.slotDate === snapshot.today).map((slot) => slot.taskId),
      ...(slotsByDate.get(snapshot.today)?.map((slot) => slot.taskId) ?? []),
    ]);

    const tomorrowTasks = slotsByDate.get(addDays(snapshot.today, 1))?.map((slot) => slot.taskId) ?? [];

    expect(todayTaskIds.size).toBeLessThanOrEqual(2);
    expect(tomorrowTasks).toContain("free-c");
  });

  it("reports capacity shortfall when the horizon is too small without due dates", () => {
    // 容量短缺：没有截止日但超出窗口容量时，应给出 capacity 原因的短缺。
    const snapshot = buildSnapshot({
      tasks: [createTask({ id: "big", estimateMinutes: 300, priority: 5 })],
    });

    const draft = draftPlan(snapshot, { lookaheadDays: 1, dailyCapacityHours: 4, slotMinutes: 60 });

    expect(draft.proposedSlots.reduce((sum, slot) => sum + slot.plannedMinutes, 0)).toBe(240);
    const warning = draft.warnings.find((item) => item.code === "capacity_shortfall");
    expect(warning?.details).toMatchObject({
      taskIds: ["big"],
      shortfalls: expect.arrayContaining([
        expect.objectContaining({ taskId: "big", minutesUnassigned: 60, reason: "capacity" }),
      ]),
    });
  });
});
