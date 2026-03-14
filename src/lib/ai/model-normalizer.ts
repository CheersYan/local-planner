import {
  AiCommand,
  AiCommandBatch,
  aiCommandBatchSchema,
  BlackoutLocator,
  TaskLocator,
} from "./command-schema";
import {
  ModelAiCommand,
  ModelAiCommandEnvelope,
  ModelPriority,
  modelCommandEnvelopeSchema,
} from "./model-command-schema";

const priorityLookup: Record<ModelPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 10,
};

const nullableToOptional = <T>(value: T | null | undefined): T | undefined =>
  value === null ? undefined : value;

const preserveNull = <T>(value: T | null | undefined): T | null | undefined =>
  value === undefined ? undefined : value;

const startOfDayUtc = (isoDate: string): string => `${isoDate}T00:00:00Z`;
const endOfDayUtc = (isoDate: string): string => `${isoDate}T23:59:59Z`;

const normalizePriority = (priority: ModelPriority): number => priorityLookup[priority];

const hoursToMinutes = (hours: number | null | undefined): number | undefined => {
  if (hours === null || hours === undefined) return undefined;
  return Math.max(0, Math.round(hours * 60));
};

const normalizeLocator = (locator: { taskId: string | null; title: string | null; fuzzyTitle: string | null }): TaskLocator => ({
  taskId: nullableToOptional(locator.taskId),
  title: nullableToOptional(locator.title),
  fuzzyTitle: nullableToOptional(locator.fuzzyTitle),
});

const normalizeBlackoutLocator = (locator: {
  blackoutId: string | null;
  startDate: string | null;
  endDate: string | null;
  fuzzyReason: string | null;
}): BlackoutLocator => ({
  blackoutId: nullableToOptional(locator.blackoutId),
  startDate: nullableToOptional(locator.startDate),
  endDate: nullableToOptional(locator.endDate),
  fuzzyReason: nullableToOptional(locator.fuzzyReason),
});

const normalizeCommand = (command: ModelAiCommand): AiCommand => {
  switch (command.type) {
    case "create_tasks":
      return {
        type: "create_tasks",
        payload: {
          tasks: command.payload.tasks.map((task) => ({
            title: task.title,
            estimateMinutes: task.estimateMinutes,
            dueDate: nullableToOptional(task.dueDate),
            priority: normalizePriority(task.priority),
            locked: task.locked,
            note: nullableToOptional(task.note),
          })),
          requestId: nullableToOptional(command.payload.requestId),
        },
      };
    case "log_completion":
      return {
        type: "log_completion",
        payload: {
          taskId: nullableToOptional(command.payload.taskId),
          title: nullableToOptional(command.payload.title),
          minutesSpent: nullableToOptional(command.payload.minutesSpent),
          markDone: command.payload.markDone,
          note: nullableToOptional(command.payload.note),
          loggedAt: nullableToOptional(command.payload.loggedAt),
        },
      };
    case "shrink_task":
      return {
        type: "shrink_task",
        payload: {
          taskId: command.payload.taskId,
          newRemainingMinutes: command.payload.newRemainingMinutes,
          previousEstimateMinutes: nullableToOptional(command.payload.previousEstimateMinutes),
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "add_blackout":
      return {
        type: "add_blackout",
        payload: {
          start: startOfDayUtc(command.payload.startDate),
          end: endOfDayUtc(command.payload.endDate),
          reason: command.payload.reason,
        },
      };
    case "update_blackout_window":
      return {
        type: "update_blackout_window",
        payload: {
          target: normalizeBlackoutLocator(command.payload.target),
          startDate: nullableToOptional(command.payload.startDate),
          endDate: nullableToOptional(command.payload.endDate),
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "delete_blackout_window":
      return {
        type: "delete_blackout_window",
        payload: {
          target: normalizeBlackoutLocator(command.payload.target),
        },
      };
    case "add_urgent_task":
      return {
        type: "add_urgent_task",
        payload: {
          title: command.payload.title,
          estimateMinutes: command.payload.estimateMinutes,
          dueDate: command.payload.dueDate,
          priority: normalizePriority(command.payload.priority),
          windowDays: command.payload.windowDays,
          locked: false,
          note: nullableToOptional(command.payload.note),
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "update_task_fields":
      return {
        type: "update_task_fields",
        payload: {
          target: normalizeLocator(command.payload.target),
          title: nullableToOptional(command.payload.title),
          estimateMinutes: hoursToMinutes(command.payload.estimateHours),
          remainingMinutes: hoursToMinutes(command.payload.remainingHours),
          dueDate: preserveNull(command.payload.dueDate),
          priority: command.payload.priority ? normalizePriority(command.payload.priority) : undefined,
          note: preserveNull(command.payload.note),
        },
      };
    case "reschedule_task":
      return {
        type: "reschedule_task",
        payload: {
          target: normalizeLocator(command.payload.target),
          dueDate: command.payload.dueDate,
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "reprioritize_task":
      return {
        type: "reprioritize_task",
        payload: {
          target: normalizeLocator(command.payload.target),
          priority: normalizePriority(command.payload.priority),
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "pause_task":
      return {
        type: "pause_task",
        payload: {
          target: normalizeLocator(command.payload.target),
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "resume_task":
      return {
        type: "resume_task",
        payload: {
          target: normalizeLocator(command.payload.target),
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "delete_task":
      return {
        type: "delete_task",
        payload: {
          target: normalizeLocator(command.payload.target),
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "restore_task":
      return {
        type: "restore_task",
        payload: {
          target: normalizeLocator(command.payload.target),
        },
      };
    case "split_task":
      return {
        type: "split_task",
        payload: {
          target: normalizeLocator(command.payload.target),
          parts: command.payload.parts.map((part) => ({
            title: part.title,
            estimateMinutes: hoursToMinutes(part.estimateHours),
            remainingMinutes: hoursToMinutes(part.remainingHours),
            dueDate: preserveNull(part.dueDate),
            priority: part.priority ? normalizePriority(part.priority) : undefined,
            note: preserveNull(part.note),
          })),
          reason: nullableToOptional(command.payload.reason),
        },
      };
    case "merge_tasks":
      return {
        type: "merge_tasks",
        payload: {
          targets: command.payload.targets.map(normalizeLocator),
          title: command.payload.title,
          estimateMinutes: hoursToMinutes(command.payload.estimateHours),
          remainingMinutes: hoursToMinutes(command.payload.remainingHours),
          dueDate: preserveNull(command.payload.dueDate),
          priority: command.payload.priority ? normalizePriority(command.payload.priority) : undefined,
          note: preserveNull(command.payload.note),
        },
      };
    case "mark_task_done":
      return {
        type: "mark_task_done",
        payload: {
          target: normalizeLocator(command.payload.target),
          note: preserveNull(command.payload.note),
        },
      };
    case "reopen_task":
      return {
        type: "reopen_task",
        payload: {
          target: normalizeLocator(command.payload.target),
          remainingMinutes: hoursToMinutes(command.payload.remainingHours) ?? 0,
          note: preserveNull(command.payload.note),
        },
      };
    default: {
      const neverCommand: never = command;
      return neverCommand;
    }
  }
};

export const normalizeModelEnvelope = (
  envelope: ModelAiCommandEnvelope
): AiCommandBatch => {
  const parsed = modelCommandEnvelopeSchema.parse(envelope);
  const normalized = parsed.commands.map(normalizeCommand);
  return aiCommandBatchSchema.parse(normalized);
};

export const normalizeModelCommandForTest = normalizeCommand;
export const normalizePriorityForTest = normalizePriority;
