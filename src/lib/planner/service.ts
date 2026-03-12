import type { BlackoutWindow, PlanSlot, Prisma, Setting, Task } from "@prisma/client";

import { materializeSettings } from "../../app/settings/config";
import { prisma } from "../prisma";
import { draftPlan } from "./draft";
import type {
  PlannerBlackout,
  PlannerDraft,
  PlannerOptions,
  PlannerSnapshot,
  PlannerSlot,
  PlannerTask,
} from "./types";

export type PlannerTransaction = {
  task: { findMany: (args?: Prisma.TaskFindManyArgs) => Promise<Task[]> };
  planSlot: {
    findMany: (args?: Prisma.PlanSlotFindManyArgs) => Promise<PlanSlot[]>;
    deleteMany: (args?: Prisma.PlanSlotDeleteManyArgs) => Promise<Prisma.BatchPayload>;
    createMany: (args: Prisma.PlanSlotCreateManyArgs) => Promise<Prisma.BatchPayload>;
  };
  blackoutWindow: { findMany: (args?: Prisma.BlackoutWindowFindManyArgs) => Promise<BlackoutWindow[]> };
  setting: { findMany: (args?: Prisma.SettingFindManyArgs) => Promise<Setting[]> };
};

export type PlannerClient = PlannerTransaction & {
  $transaction: <T>(fn: (tx: PlannerTransaction) => Promise<T>) => Promise<T>;
};

export type PlannerServiceOptions = {
  now?: Date;
  client?: PlannerClient;
};

export type PlannerServiceResult = {
  today: string;
  draft: PlannerDraft;
  createdSlots: number;
  deletedSlots: number;
};

const DEFAULT_MAX_TASK_TYPES_PER_DAY = 3;

const prismaClient: PlannerClient = {
  task: prisma.task,
  planSlot: prisma.planSlot,
  blackoutWindow: prisma.blackoutWindow,
  setting: prisma.setting,
  $transaction: async (fn) =>
    prisma.$transaction((tx) =>
      fn({
        task: tx.task,
        planSlot: tx.planSlot,
        blackoutWindow: tx.blackoutWindow,
        setting: tx.setting,
      }),
    ),
};

/**
 * Regenerate plan slots based on tasks, settings, and blackout windows.
 * - Only today and future unlocked slots are rewritten; history is untouched.
 * - Locked slots remain frozen and participate in planning.
 */
export const generatePlanSlots = async (
  options: PlannerServiceOptions = {},
): Promise<PlannerServiceResult> => {
  const client = options.client ?? prismaClient;
  const todayDate = startOfLocalDay(options.now ?? new Date());
  const todayIso = formatISODate(todayDate);

  return client.$transaction(async (tx) => {
    const [tasks, planSlots, blackoutWindows, settingRecords] = await Promise.all([
      tx.task.findMany(),
      tx.planSlot.findMany(),
      tx.blackoutWindow.findMany(),
      tx.setting.findMany(),
    ]);

    const settings = materializeSettings(settingRecords);
    const lookaheadDays = resolveLookaheadDays(settingRecords, settings.planningHorizonDays);
    const maxTaskTypesPerDay = resolveMaxTaskTypesPerDay(settingRecords);

    const snapshot: PlannerSnapshot = {
      today: todayIso,
      tasks: tasks.map(toPlannerTask),
      planSlots: planSlots.map(toPlannerSlot),
      blackoutWindows: mergeBlackouts(blackoutWindows, settings.allowWeekendWork, todayIso, lookaheadDays),
      goals: [],
      inbox: [],
    };

    const plannerOptions: PlannerOptions = {
      lookaheadDays,
      dailyCapacityHours: settings.dailyCapacityHours,
      slotMinutes: 60,
      maxTaskTypesPerDay,
    };

    const draft = draftPlan(snapshot, plannerOptions);

    const deleteResult = await tx.planSlot.deleteMany({
      where: {
        slotDate: { gte: todayDate },
        locked: false,
      },
    });

    if (draft.proposedSlots.length > 0) {
      await tx.planSlot.createMany({
        data: draft.proposedSlots.map(toPlanSlotCreateInput),
      });
    }

    return {
      today: todayIso,
      draft,
      createdSlots: draft.proposedSlots.length,
      deletedSlots: deleteResult.count,
    };
  });
};

const toPlannerTask = (task: Task): PlannerTask => ({
  id: task.id,
  title: task.title,
  status: normalizeTaskStatus(task.status),
  estimateMinutes: task.estimateMinutes,
  actualMinutes: task.actualMinutes ?? undefined,
  dueDate: toOptionalISODate(task.dueDate),
  plannedDate: toOptionalISODate(task.plannedDate),
  priority: task.priority,
  locked: task.locked,
});

const toPlannerSlot = (slot: PlanSlot): PlannerSlot => ({
  id: slot.id,
  taskId: slot.taskId,
  slotDate: formatISODate(slot.slotDate),
  plannedMinutes: slot.plannedMinutes,
  position: slot.position,
  locked: slot.locked,
});

const toPlanSlotCreateInput = (slot: PlannerSlot): Prisma.PlanSlotCreateManyInput => ({
  taskId: slot.taskId,
  slotDate: toUTCDate(slot.slotDate),
  plannedMinutes: slot.plannedMinutes,
  position: slot.position,
  locked: slot.locked,
});

const pickSettingValue = (records: Setting[], key: string): string | undefined =>
  records.find((record) => record.key === key)?.value;

const parseWholeNumberSetting = (value: string | undefined, fallback: number, min = 1, max = 60): number => {
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
};

const resolveLookaheadDays = (records: Setting[], fallback: number): number => {
  const raw = pickSettingValue(records, "planningHorizonDays") ?? pickSettingValue(records, "lookaheadDays");
  return parseWholeNumberSetting(raw, fallback, 1, 60);
};

const resolveMaxTaskTypesPerDay = (records: Setting[]): number => {
  const raw = pickSettingValue(records, "maxTaskTypesPerDay");
  return parseWholeNumberSetting(raw, DEFAULT_MAX_TASK_TYPES_PER_DAY, 1, 10);
};

const mergeBlackouts = (
  windows: BlackoutWindow[],
  allowWeekendWork: boolean,
  todayIso: string,
  horizonDays: number,
): PlannerBlackout[] => {
  const todayStart = toUTCDate(todayIso);
  const normalized = windows
    .map((window) => ({
      id: window.id,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      reason: window.reason,
    }))
    .filter((window) => new Date(window.end) >= todayStart);

  if (allowWeekendWork) {
    return normalized;
  }

  const weekendBlocks = enumerateDates(todayIso, horizonDays).flatMap((isoDate) => {
    const dayOfWeek = toUTCDate(isoDate).getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const start = toUTCDate(isoDate);
      const end = new Date(start);
      end.setUTCHours(23, 59, 59, 999);

      const id = `weekend-${isoDate}`;

      return [
        {
          id,
          start: start.toISOString(),
          end: end.toISOString(),
          reason: "Weekend blocked (allowWeekendWork=false)",
        },
      ];
    }

    return [];
  });

  return [...normalized, ...weekendBlocks];
};

const normalizeTaskStatus = (status: string): PlannerTask["status"] => {
  if (status === "in_progress" || status === "done" || status === "dropped" || status === "planned") {
    return status;
  }

  return "planned";
};

const toOptionalISODate = (value: Date | null): string | undefined => {
  if (!value) return undefined;
  return formatISODate(value);
};

const startOfLocalDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const formatISODate = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toUTCDate = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const enumerateDates = (startIso: string, days: number): string[] => {
  const dates: string[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = toUTCDate(startIso);
    date.setUTCDate(date.getUTCDate() + offset);
    dates.push(formatISODate(date));
  }
  return dates;
};
