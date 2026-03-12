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

const toUtcDate = (isoDate: string): Date => {
  const match = isoDatePattern.exec(isoDate);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  return new Date(Date.UTC(year, month - 1, day));
};

export const modelIsoDateSchema = z
  .string()
  .regex(isoDatePattern, "Expected ISO date (YYYY-MM-DD)")
  .refine(isValidIsoDate, "Invalid calendar date");

export const modelIsoDateTimeSchema = z
  .string()
  .regex(isoDateTimePattern, "Expected ISO datetime with timezone")
  .refine(isValidIsoDateTime, "Invalid datetime value");

export const modelPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

const modelCreateTaskSchema = z
  .object({
    title: z.string(),
    estimateMinutes: z.number().int().positive(),
    dueDate: modelIsoDateSchema.nullable(),
    priority: modelPrioritySchema,
    locked: z.boolean(),
    note: z.string().max(500).nullable(),
  })
  .strict();

export const modelCreateTasksCommandSchema = z
  .object({
    type: z.literal("create_tasks"),
    payload: z
      .object({
        tasks: z.array(modelCreateTaskSchema).min(1),
        requestId: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type ModelCreateTasksCommand = z.infer<typeof modelCreateTasksCommandSchema>;

export const modelLogCompletionCommandSchema = z
  .object({
    type: z.literal("log_completion"),
    payload: z
      .object({
        taskId: z.string().nullable(),
        title: z.string().nullable(),
        minutesSpent: z.number().int().positive().nullable(),
        markDone: z.boolean(),
        note: z.string().max(500).nullable(),
        loggedAt: modelIsoDateTimeSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(({ payload }) => payload.taskId !== null || payload.title !== null, {
    message: "taskId or title is required",
    path: ["payload", "taskId"],
  })
  .refine(({ payload }) => payload.minutesSpent !== null || payload.markDone === true, {
    message: "minutesSpent may be null only when markDone is true",
    path: ["payload", "minutesSpent"],
  });

export type ModelLogCompletionCommand = z.infer<typeof modelLogCompletionCommandSchema>;

export const modelShrinkTaskCommandSchema = z
  .object({
    type: z.literal("shrink_task"),
    payload: z
      .object({
        taskId: z.string(),
        newRemainingMinutes: z.number().int().nonnegative(),
        previousEstimateMinutes: z.number().int().positive().nullable(),
        reason: z.string().max(300).nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ payload }) =>
      payload.previousEstimateMinutes === null ||
      payload.newRemainingMinutes <= payload.previousEstimateMinutes,
    {
      message: "newRemainingMinutes must be <= previousEstimateMinutes when provided",
      path: ["payload", "newRemainingMinutes"],
    }
  );

export type ModelShrinkTaskCommand = z.infer<typeof modelShrinkTaskCommandSchema>;

export const modelAddBlackoutCommandSchema = z
  .object({
    type: z.literal("add_blackout"),
    payload: z
      .object({
        startDate: modelIsoDateSchema,
        endDate: modelIsoDateSchema,
        reason: z.string(),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ payload }) => toUtcDate(payload.endDate).getTime() >= toUtcDate(payload.startDate).getTime(),
    { message: "endDate must be on or after startDate", path: ["payload", "endDate"] }
  );

export type ModelAddBlackoutCommand = z.infer<typeof modelAddBlackoutCommandSchema>;

export const modelAddUrgentTaskCommandSchema = z
  .object({
    type: z.literal("add_urgent_task"),
    payload: z
      .object({
        title: z.string(),
        estimateMinutes: z.number().int().positive(),
        dueDate: modelIsoDateSchema,
        priority: modelPrioritySchema,
        windowDays: z.number().int().positive(),
        note: z.string().max(500).nullable(),
        reason: z.string().max(300).nullable(),
      })
      .strict(),
  })
  .strict();

export type ModelAddUrgentTaskCommand = z.infer<typeof modelAddUrgentTaskCommandSchema>;

export const modelCommandSchema = z.discriminatedUnion("type", [
  modelCreateTasksCommandSchema,
  modelLogCompletionCommandSchema,
  modelShrinkTaskCommandSchema,
  modelAddBlackoutCommandSchema,
  modelAddUrgentTaskCommandSchema,
]);

export type ModelAiCommand = z.infer<typeof modelCommandSchema>;

export const modelCommandEnvelopeSchema = z
  .object({
    commands: z.array(modelCommandSchema).min(1),
  })
  .strict();

export type ModelAiCommandEnvelope = z.infer<typeof modelCommandEnvelopeSchema>;
