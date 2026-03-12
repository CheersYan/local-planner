import { z } from "zod";

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTimePattern =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const isValidIsoDate = (value: string): boolean => {
  const match = isoDatePattern.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

const isValidIsoDateTime = (value: string): boolean => {
  const match = isoDateTimePattern.exec(value);
  if (!match) return false;

  const [, datePart, hours, minutes, seconds] = match;
  const hourNum = Number(hours);
  const minuteNum = Number(minutes);
  const secondNum = Number(seconds);

  if (
    hourNum < 0 ||
    hourNum > 23 ||
    minuteNum < 0 ||
    minuteNum > 59 ||
    secondNum < 0 ||
    secondNum > 59
  ) {
    return false;
  }

  return isValidIsoDate(datePart);
};

export const isoDateSchema = z
  .string()
  .regex(isoDatePattern, "Expected ISO date (YYYY-MM-DD)")
  .refine(isValidIsoDate, "Invalid calendar date");

export const isoDateTimeSchema = z
  .string()
  .regex(isoDateTimePattern, "Expected ISO datetime with timezone")
  .refine(isValidIsoDateTime, "Invalid datetime value");

const taskStatusSchema = z.enum(["todo", "planned", "in_progress", "done", "dropped"]);

// Read-only slice of the database the AI is allowed to see.
export const aiReadableTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  estimateMinutes: z.number().int().nonnegative(),
  actualMinutes: z.number().int().nonnegative().optional(),
  dueDate: isoDateSchema.optional(),
  plannedDate: isoDateSchema.optional(),
  priority: z.number().int(),
  locked: z.boolean(),
});

export type AiReadableTask = z.infer<typeof aiReadableTaskSchema>;

export const aiReadableContextSchema = z.object({
  tasks: z.array(aiReadableTaskSchema).default([]),
});

export type AiReadableContext = z.infer<typeof aiReadableContextSchema>;

const baseTaskCreationSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  estimateMinutes: z.number().int().positive(),
  dueDate: isoDateSchema.optional(),
  priority: z.number().int().default(1),
  locked: z.boolean().default(false),
  note: z.string().max(500).optional(),
});

export const createTasksCommandSchema = z.object({
  type: z.literal("create_tasks"),
  payload: z.object({
    tasks: z.array(baseTaskCreationSchema).min(1, "At least one task is required"),
    requestId: z.string().optional(),
  }),
});

export type CreateTasksCommand = z.infer<typeof createTasksCommandSchema>;

export const logCompletionCommandSchema = z
  .object({
    type: z.literal("log_completion"),
    payload: z.object({
      taskId: z.string().optional(),
      title: z.string().optional(),
      minutesSpent: z.number().int().positive().optional(),
      note: z.string().max(500).optional(),
      loggedAt: isoDateTimeSchema.optional(),
    }),
  })
  .refine(({ payload }) => Boolean(payload.taskId || payload.title), {
    message: "Either taskId or title is required",
    path: ["payload", "taskId"],
  });

export type LogCompletionCommand = z.infer<typeof logCompletionCommandSchema>;

export const shrinkTaskCommandSchema = z
  .object({
    type: z.literal("shrink_task"),
    payload: z.object({
      taskId: z.string(),
      newEstimateMinutes: z.number().int().positive(),
      previousEstimateMinutes: z.number().int().positive().optional(),
      reason: z.string().max(300).optional(),
    }),
  })
  .refine(
    ({ payload }) =>
      payload.previousEstimateMinutes === undefined ||
      payload.newEstimateMinutes < payload.previousEstimateMinutes,
    {
      message: "newEstimateMinutes must be smaller than previousEstimateMinutes",
      path: ["payload", "newEstimateMinutes"],
    }
  );

export type ShrinkTaskCommand = z.infer<typeof shrinkTaskCommandSchema>;

export const addBlackoutCommandSchema = z
  .object({
    type: z.literal("add_blackout"),
    payload: z.object({
      start: isoDateTimeSchema,
      end: isoDateTimeSchema,
      reason: z.string().min(1, "Reason is required"),
    }),
  })
  .refine(
    ({ payload }) => new Date(payload.end).getTime() > new Date(payload.start).getTime(),
    {
      message: "end must be after start",
      path: ["payload", "end"],
    }
  );

export type AddBlackoutCommand = z.infer<typeof addBlackoutCommandSchema>;

const urgentTaskPayloadSchema = baseTaskCreationSchema.extend({
  dueDate: isoDateSchema,
  priority: z.number().int().min(1).default(10),
  windowDays: z.number().int().positive().max(14).default(3),
  reason: z.string().max(300).optional(),
});

export const addUrgentTaskCommandSchema = z.object({
  type: z.literal("add_urgent_task"),
  payload: urgentTaskPayloadSchema,
});

export type AddUrgentTaskCommand = z.infer<typeof addUrgentTaskCommandSchema>;

export const aiCommandSchema = z.discriminatedUnion("type", [
  createTasksCommandSchema,
  logCompletionCommandSchema,
  shrinkTaskCommandSchema,
  addBlackoutCommandSchema,
  addUrgentTaskCommandSchema,
]);

export type AiCommand = z.infer<typeof aiCommandSchema>;

export const aiCommandBatchSchema = z.array(aiCommandSchema).min(1);

export type AiCommandBatch = z.infer<typeof aiCommandBatchSchema>;
