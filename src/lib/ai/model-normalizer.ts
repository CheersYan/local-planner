import {
  AiCommand,
  AiCommandBatch,
  aiCommandBatchSchema,
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

const startOfDayUtc = (isoDate: string): string => `${isoDate}T00:00:00Z`;
const endOfDayUtc = (isoDate: string): string => `${isoDate}T23:59:59Z`;

const normalizePriority = (priority: ModelPriority): number => priorityLookup[priority];

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
