import {
  PlannerBlackout,
  PlannerDraft,
  PlannerOptions,
  PlannerSlot,
  PlannerSnapshot,
  PlannerTask,
  PlannerWarning,
} from "./types";

const DEFAULT_LOOKAHEAD_DAYS = 14;
const DEFAULT_SLOT_MINUTES = 60;
const DEFAULT_DAILY_CAPACITY_HOURS = 8;
const DEFAULT_MAX_TASK_TYPES_PER_DAY = 3;

type DateBucket = {
  usedMinutes: number;
  nextPosition: number;
  proposedSlots: PlannerSlot[];
  taskMinutes: Map<string, number>;
};

type TaskWork = {
  task: PlannerTask;
  index: number;
  remainingMinutes: number;
  dueDate?: string;
};

type TaskPressure = {
  requiredToday: number;
  slackMinutes: number;
  schedulableDaysCount: number;
};

/**
 * Deterministic and pure planner draft generator.
 *
 * Rules:
 * - past slots are frozen
 * - locked future slots are frozen and count against remaining task minutes
 * - unlocked future slots are ignored and fully replanned
 * - blackout dates are unschedulable
 * - dueDate is treated as a hard upper bound for newly proposed slots
 * - capacity is enforced per day
 * - same-day scheduling mixes long tasks with a small number of other tasks by round-robin allocation
 */
export function draftPlan(snapshot: PlannerSnapshot, options: PlannerOptions = {}): PlannerDraft {
  const today = requireISODate(snapshot.today, "snapshot.today");
  const lookaheadDays = clampWholeNumber(options.lookaheadDays, DEFAULT_LOOKAHEAD_DAYS, 1);
  const slotMinutes = clampWholeNumber(options.slotMinutes, DEFAULT_SLOT_MINUTES, 1);
  const dailyCapacityHours = Math.max(options.dailyCapacityHours ?? DEFAULT_DAILY_CAPACITY_HOURS, 0.25);
  const dailyCapacityMinutes = Math.max(1, Math.round(dailyCapacityHours * 60));
  const maxTaskTypesPerDay = clampWholeNumber(
    options.maxTaskTypesPerDay,
    DEFAULT_MAX_TASK_TYPES_PER_DAY,
    1,
  );

  const horizonStart = today;
  const horizonEnd = addDays(today, lookaheadDays - 1);
  const blackoutDates = collectBlackoutDates(snapshot.blackoutWindows);

  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const frozenSlots: PlannerSlot[] = [];
  const workingLockedSlots: PlannerSlot[] = [];
  const outsideLookaheadSlots: PlannerSlot[] = [];
  const lockedOverflowSlots: PlannerSlot[] = [];
  const lockedMinutesByTask = new Map<string, number>();
  const lockedMinutesAfterDueByTask = new Map<string, number>();

  const normalizedPlanSlots = [...snapshot.planSlots]
    .map(normalizeSlot)
    .sort(sortSlotRecords);

  for (const slot of normalizedPlanSlots) {
    const task = taskById.get(slot.taskId);
    const status = task?.status ?? "planned";
    const isDoneOrDropped = status === "done" || status === "dropped";

    if (compareDates(slot.slotDate, horizonStart) < 0) {
      frozenSlots.push(slot);
      continue;
    }

    if (slot.locked) {
      frozenSlots.push(slot);
      addMinutes(lockedMinutesByTask, slot.taskId, slot.plannedMinutes);

      const taskDueDate = normalizeOptionalISODate(task?.dueDate);
      if (taskDueDate && compareDates(slot.slotDate, taskDueDate) > 0) {
        addMinutes(lockedMinutesAfterDueByTask, slot.taskId, slot.plannedMinutes);
      }

      if (blackoutDates.has(slot.slotDate)) {
        lockedOverflowSlots.push(slot);
      } else if (compareDates(slot.slotDate, horizonEnd) > 0) {
        outsideLookaheadSlots.push(slot);
      } else if (!isDoneOrDropped) {
        workingLockedSlots.push(slot);
      }

      continue;
    }

    // unlocked future slots are intentionally ignored because they are fully replanned
  }

  const tasksNeedingMinutes: TaskWork[] = snapshot.tasks
    .filter((task) => task.status !== "done" && task.status !== "dropped")
    .map((task, index) => {
      const remainingMinutes = Math.max(
        0,
        normalizeMinutes(task.estimateMinutes) -
          normalizeMinutes(task.actualMinutes) -
          (lockedMinutesByTask.get(task.id) ?? 0),
      );

      return {
        task,
        index,
        remainingMinutes,
        dueDate: normalizeOptionalISODate(task.dueDate),
      };
    })
    .filter((entry) => entry.remainingMinutes > 0)
    .sort(sortTasksByUrgency);

  const workingDates = enumerateDates(horizonStart, horizonEnd).filter((date) => !blackoutDates.has(date));
  const dateBuckets = buildDateBuckets(workingDates, workingLockedSlots);

  for (const date of workingDates) {
    const bucket = dateBuckets.get(date);
    if (!bucket) {
      continue;
    }

    const availableMinutes = dailyCapacityMinutes - bucket.usedMinutes;
    if (availableMinutes <= 0) {
      continue;
    }

    const rankedCandidates = tasksNeedingMinutes
      .filter((taskWork) => taskWork.remainingMinutes > 0 && canScheduleTaskOnDate(taskWork, date))
      .sort((left, right) => sortTasksForDate(left, right, date, workingDates, dailyCapacityMinutes));

    if (rankedCandidates.length === 0) {
      continue;
    }

    const activeTasks = selectActiveTasksForDate(rankedCandidates, bucket, maxTaskTypesPerDay);
    if (activeTasks.length === 0) {
      continue;
    }

    allocateRequiredMinutesForDate(activeTasks, bucket, date, workingDates, dailyCapacityMinutes, slotMinutes);
    allocateRoundRobinForDate(activeTasks, bucket, date, workingDates, dailyCapacityMinutes, slotMinutes);
  }

  const unassignedTaskIds: string[] = [];
  const shortfalls: Array<{
    taskId: string;
    minutesUnassigned: number;
    reason: "capacity" | "due_date" | "due_date_locked_conflict";
    dueDate?: string;
  }> = [];

  for (const taskWork of tasksNeedingMinutes) {
    const lockedMinutesAfterDue = lockedMinutesAfterDueByTask.get(taskWork.task.id) ?? 0;
    const taskHasShortfall = lockedMinutesAfterDue > 0 || taskWork.remainingMinutes > 0;

    if (taskHasShortfall) {
      unassignedTaskIds.push(taskWork.task.id);
    }

    if (lockedMinutesAfterDue > 0) {
      shortfalls.push({
        taskId: taskWork.task.id,
        minutesUnassigned: lockedMinutesAfterDue,
        reason: "due_date_locked_conflict",
        dueDate: taskWork.dueDate,
      });
    }

    if (taskWork.remainingMinutes > 0) {
      shortfalls.push({
        taskId: taskWork.task.id,
        minutesUnassigned: taskWork.remainingMinutes,
        reason: taskWork.dueDate ? "due_date" : "capacity",
        dueDate: taskWork.dueDate,
      });
    }
  }

  const warnings: PlannerWarning[] = [];

  if (outsideLookaheadSlots.length > 0) {
    warnings.push({
      code: "outside_lookahead",
      message: "Some locked slots already exist outside the current lookahead window.",
      details: {
        taskIds: unique(outsideLookaheadSlots.map((slot) => slot.taskId)),
        slotIds: outsideLookaheadSlots.map((slot) => slot.id),
        dates: outsideLookaheadSlots.map((slot) => slot.slotDate),
      },
    });
  }

  if (lockedOverflowSlots.length > 0) {
    warnings.push({
      code: "locked_overflow",
      message: "Some locked slots fall on blackout dates and cannot be moved automatically.",
      details: {
        taskIds: unique(lockedOverflowSlots.map((slot) => slot.taskId)),
        slotIds: lockedOverflowSlots.map((slot) => slot.id),
        dates: lockedOverflowSlots.map((slot) => slot.slotDate),
      },
    });
  }

  if (shortfalls.length > 0) {
    warnings.push({
      code: "capacity_shortfall",
      message:
        "Not enough schedulable time exists within the current horizon and task due dates to place all remaining work.",
      details: {
        taskIds: unique(shortfalls.map((item) => item.taskId)),
        shortfalls,
      },
    });
  }

  return {
    frozenSlots: sortSlots(frozenSlots),
    proposedSlots: flattenBuckets(dateBuckets),
    unassignedTaskIds,
    warnings,
    appliedOptions: {
      lookaheadDays,
      slotMinutes,
      dailyCapacityHours,
      maxTaskTypesPerDay,
    },
  };
}

const clampWholeNumber = (value: number | undefined, fallback: number, min: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.floor(value));
};

const normalizeMinutes = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
};

const normalizeSlot = (slot: PlannerSlot): PlannerSlot => ({
  ...slot,
  slotDate: requireISODate(slot.slotDate, `plan slot ${slot.id}`),
  plannedMinutes: normalizeMinutes(slot.plannedMinutes),
  position: Math.max(0, Math.floor(slot.position)),
});

const buildDateBuckets = (workingDates: string[], lockedSlots: PlannerSlot[]): Map<string, DateBucket> => {
  const buckets = new Map<string, DateBucket>();

  for (const date of workingDates) {
    buckets.set(date, { usedMinutes: 0, nextPosition: 0, proposedSlots: [], taskMinutes: new Map() });
  }

  for (const slot of sortSlots(lockedSlots)) {
    const bucket = buckets.get(slot.slotDate);
    if (!bucket) {
      continue;
    }

    bucket.usedMinutes += slot.plannedMinutes;
    bucket.nextPosition = Math.max(bucket.nextPosition, slot.position + 1);
    addMinutes(bucket.taskMinutes, slot.taskId, slot.plannedMinutes);
  }

  return buckets;
};

const flattenBuckets = (buckets: Map<string, DateBucket>): PlannerSlot[] => {
  const slots: PlannerSlot[] = [];

  for (const [, bucket] of [...buckets.entries()].sort(([left], [right]) => compareDates(left, right))) {
    slots.push(...sortSlots(bucket.proposedSlots));
  }

  return slots;
};

const selectActiveTasksForDate = (
  rankedCandidates: TaskWork[],
  bucket: DateBucket,
  maxTaskTypesPerDay: number,
): TaskWork[] => {
  const tasks: TaskWork[] = [];
  const selectedIds = new Set<string>();
  const taskTypesAlreadyPresent = bucket.taskMinutes.size;
  const newTaskTypesAllowed = Math.max(0, maxTaskTypesPerDay - taskTypesAlreadyPresent);
  let newTaskTypesSelected = 0;

  for (const candidate of rankedCandidates) {
    if (bucket.taskMinutes.has(candidate.task.id) && !selectedIds.has(candidate.task.id)) {
      selectedIds.add(candidate.task.id);
      tasks.push(candidate);
    }
  }

  for (const candidate of rankedCandidates) {
    if (selectedIds.has(candidate.task.id)) {
      continue;
    }

    if (newTaskTypesSelected >= newTaskTypesAllowed) {
      break;
    }

    selectedIds.add(candidate.task.id);
    tasks.push(candidate);
    newTaskTypesSelected += 1;
  }

  return tasks;
};

const allocateRequiredMinutesForDate = (
  activeTasks: TaskWork[],
  bucket: DateBucket,
  date: string,
  workingDates: string[],
  dailyCapacityMinutes: number,
  slotMinutes: number,
): void => {
  const ranked = [...activeTasks].sort((left, right) => sortTasksForDate(left, right, date, workingDates, dailyCapacityMinutes));

  for (const taskWork of ranked) {
    if (taskWork.remainingMinutes <= 0) {
      continue;
    }

    const pressure = getTaskPressureForDate(taskWork, date, workingDates, dailyCapacityMinutes);
    const currentMinutesOnDate = bucket.taskMinutes.get(taskWork.task.id) ?? 0;
    const requiredAdditionalMinutes = Math.max(0, pressure.requiredToday - currentMinutesOnDate);

    if (requiredAdditionalMinutes <= 0) {
      continue;
    }

    allocateMinutesToTask(taskWork, bucket, date, requiredAdditionalMinutes, slotMinutes, dailyCapacityMinutes);
  }
};

const allocateRoundRobinForDate = (
  activeTasks: TaskWork[],
  bucket: DateBucket,
  date: string,
  workingDates: string[],
  dailyCapacityMinutes: number,
  slotMinutes: number,
): void => {
  while (true) {
    const remainingCapacity = getBucketRemainingCapacity(bucket, dailyCapacityMinutes);
    if (remainingCapacity <= 0) {
      break;
    }

    const ranked = [...activeTasks]
      .filter((taskWork) => taskWork.remainingMinutes > 0)
      .sort((left, right) => sortTasksForDate(left, right, date, workingDates, dailyCapacityMinutes));

    if (ranked.length === 0) {
      break;
    }

    let progressed = false;

    for (const taskWork of ranked) {
      if (getBucketRemainingCapacity(bucket, dailyCapacityMinutes) <= 0 || taskWork.remainingMinutes <= 0) {
        break;
      }

      const before = taskWork.remainingMinutes;
      allocateMinutesToTask(taskWork, bucket, date, slotMinutes, slotMinutes, dailyCapacityMinutes);
      if (taskWork.remainingMinutes < before) {
        progressed = true;
      }
    }

    if (!progressed) {
      break;
    }
  }
};

const allocateMinutesToTask = (
  taskWork: TaskWork,
  bucket: DateBucket,
  date: string,
  targetMinutes: number,
  slotMinutes: number,
  dailyCapacityMinutes: number,
): number => {
  let allocatedMinutes = 0;
  let remainingTarget = Math.max(0, Math.round(targetMinutes));

  while (remainingTarget > 0 && taskWork.remainingMinutes > 0) {
    const remainingCapacity = getBucketRemainingCapacity(bucket, dailyCapacityMinutes);
    const chunkMinutes = Math.min(
      remainingTarget,
      taskWork.remainingMinutes,
      remainingCapacity,
      Math.max(1, slotMinutes),
    );

    if (chunkMinutes <= 0) {
      break;
    }

    const slot: PlannerSlot = {
      id: `auto-${taskWork.task.id}-${date}-${bucket.nextPosition}`,
      taskId: taskWork.task.id,
      slotDate: date,
      plannedMinutes: chunkMinutes,
      position: bucket.nextPosition,
      locked: false,
    };

    bucket.proposedSlots.push(slot);
    bucket.usedMinutes += chunkMinutes;
    bucket.nextPosition += 1;
    addMinutes(bucket.taskMinutes, taskWork.task.id, chunkMinutes);

    taskWork.remainingMinutes -= chunkMinutes;
    remainingTarget -= chunkMinutes;
    allocatedMinutes += chunkMinutes;
  }

  return allocatedMinutes;
};

const getBucketRemainingCapacity = (bucket: DateBucket, dailyCapacityMinutes: number): number =>
  Math.max(0, dailyCapacityMinutes - bucket.usedMinutes);

const getTaskPressureForDate = (
  taskWork: TaskWork,
  currentDate: string,
  workingDates: string[],
  dailyCapacityMinutes: number,
): TaskPressure => {
  const schedulableDates = workingDates.filter(
    (date) => compareDates(date, currentDate) >= 0 && (!taskWork.dueDate || compareDates(date, taskWork.dueDate) <= 0),
  );

  const schedulableDaysCount = schedulableDates.length;
  const capacityWithinWindow = schedulableDaysCount * dailyCapacityMinutes;
  const slackMinutes = capacityWithinWindow - taskWork.remainingMinutes;
  const maxFutureCapacityExcludingToday = Math.max(0, schedulableDaysCount - 1) * dailyCapacityMinutes;
  const requiredToday = Math.max(0, taskWork.remainingMinutes - maxFutureCapacityExcludingToday);

  return {
    requiredToday,
    slackMinutes,
    schedulableDaysCount,
  };
};

const canScheduleTaskOnDate = (taskWork: TaskWork, date: string): boolean =>
  !taskWork.dueDate || compareDates(date, taskWork.dueDate) <= 0;

const collectBlackoutDates = (windows: PlannerBlackout[]): Set<string> => {
  const dates = new Set<string>();

  for (const window of windows) {
    const startDate = extractDatePortion(window.start);
    const endDate = extractDatePortion(window.end);

    if (!startDate || !endDate) {
      continue;
    }

    const normalizedStart = requireISODate(startDate, `blackout ${window.id} start`);
    const normalizedEnd = requireISODate(endDate, `blackout ${window.id} end`);
    const [rangeStart, rangeEnd] =
      compareDates(normalizedStart, normalizedEnd) <= 0
        ? [normalizedStart, normalizedEnd]
        : [normalizedEnd, normalizedStart];

    for (const date of enumerateDates(rangeStart, rangeEnd)) {
      dates.add(date);
    }
  }

  return dates;
};

const sortTasksByUrgency = (left: TaskWork, right: TaskWork): number => {
  const dueDiff = compareOptionalDates(left.dueDate, right.dueDate);
  if (dueDiff !== 0) {
    return dueDiff;
  }

  const priorityDiff = right.task.priority - left.task.priority;
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return left.index - right.index;
};

const sortTasksForDate = (
  left: TaskWork,
  right: TaskWork,
  currentDate: string,
  workingDates: string[],
  dailyCapacityMinutes: number,
): number => {
  const leftPressure = getTaskPressureForDate(left, currentDate, workingDates, dailyCapacityMinutes);
  const rightPressure = getTaskPressureForDate(right, currentDate, workingDates, dailyCapacityMinutes);

  const requiredTodayDiff = rightPressure.requiredToday - leftPressure.requiredToday;
  if (requiredTodayDiff !== 0) {
    return requiredTodayDiff;
  }

  const slackDiff = leftPressure.slackMinutes - rightPressure.slackMinutes;
  if (slackDiff !== 0) {
    return slackDiff;
  }

  const dueDiff = compareOptionalDates(left.dueDate, right.dueDate);
  if (dueDiff !== 0) {
    return dueDiff;
  }

  const priorityDiff = right.task.priority - left.task.priority;
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  if (leftPressure.schedulableDaysCount !== rightPressure.schedulableDaysCount) {
    return leftPressure.schedulableDaysCount - rightPressure.schedulableDaysCount;
  }

  return left.index - right.index;
};

const sortSlotRecords = (left: PlannerSlot, right: PlannerSlot): number => {
  const dateDiff = compareDates(left.slotDate, right.slotDate);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const positionDiff = left.position - right.position;
  if (positionDiff !== 0) {
    return positionDiff;
  }

  return left.id.localeCompare(right.id);
};

const sortSlots = (slots: PlannerSlot[]): PlannerSlot[] => [...slots].sort(sortSlotRecords);

const compareOptionalDates = (left?: string, right?: string): number => {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return compareDates(left, right);
};

const compareDates = (left: string, right: string): number => left.localeCompare(right);

const enumerateDates = (start: string, end: string): string[] => {
  const dates: string[] = [];
  let current = start;

  while (compareDates(current, end) <= 0) {
    dates.push(current);
    current = addDays(current, 1);
  }

  return dates;
};

const addDays = (isoDate: string, days: number): string => {
  const value = new Date(`${isoDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const requireISODate = (input: string, label: string): string => {
  const normalized = normalizeOptionalISODate(input);
  if (!normalized) {
    throw new Error(`Invalid ISO date for ${label}: ${input}`);
  }

  return normalized;
};

const normalizeOptionalISODate = (input?: string): string | undefined => {
  if (!input) {
    return undefined;
  }

  const datePortion = extractDatePortion(input);
  if (!datePortion) {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePortion)) {
    return undefined;
  }

  const check = new Date(`${datePortion}T00:00:00Z`);
  if (Number.isNaN(check.getTime())) {
    return undefined;
  }

  return datePortion;
};

const extractDatePortion = (input: string): string | undefined => {
  const match = input.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
};

const addMinutes = (target: Map<string, number>, taskId: string, minutes: number): void => {
  target.set(taskId, (target.get(taskId) ?? 0) + minutes);
};

const unique = <T>(values: T[]): T[] => [...new Set(values)];
