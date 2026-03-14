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

export const modelIsoDateSchema = z
  .string()
  .regex(isoDatePattern, "Expected ISO date (YYYY-MM-DD)")
  .refine(isValidIsoDate, "Invalid calendar date");

export const modelIsoDateTimeSchema = z
  .string()
  .regex(isoDateTimePattern, "Expected ISO datetime with timezone")
  .refine(isValidIsoDateTime, "Invalid datetime value");

export const modelPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type ModelPriority = z.infer<typeof modelPrioritySchema>;

export const modelTaskStatusSchema = z.enum(["active", "paused", "completed", "archived"]);
export type ModelTaskStatus = z.infer<typeof modelTaskStatusSchema>;

const modelTaskLocatorSchema = z
  .object({
    taskId: z.string().nullable(),
    title: z.string().nullable(),
    fuzzyTitle: z.string().nullable(),
  })
  .strict()
  .refine(({ taskId, title, fuzzyTitle }) => Boolean(taskId || title || fuzzyTitle), {
    message: "taskId, title, or fuzzyTitle is required",
    path: ["taskId"],
  });

const modelBlackoutLocatorSchema = z
  .object({
    blackoutId: z.string().nullable(),
    startDate: modelIsoDateSchema.nullable(),
    endDate: modelIsoDateSchema.nullable(),
    fuzzyReason: z.string().nullable(),
  })
  .strict()
  .refine(
    ({ blackoutId, startDate, endDate, fuzzyReason }) =>
      Boolean(blackoutId || fuzzyReason || (startDate && endDate)),
    {
      message: "blackoutId, fuzzyReason, or both startDate and endDate are required",
      path: ["blackoutId"],
    },
  )
  .refine(({ startDate, endDate }) => Boolean((!startDate && !endDate) || (startDate && endDate)), {
    message: "startDate and endDate must be provided together",
    path: ["startDate"],
  })
  .refine(({ startDate, endDate }) => {
    if (startDate && endDate) {
      return new Date(`${endDate}T00:00:00Z`).getTime() >= new Date(`${startDate}T00:00:00Z`).getTime();
    }
    return true;
  }, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

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
    ({ payload }) =>
      new Date(`${payload.endDate}T00:00:00Z`).getTime() >= new Date(`${payload.startDate}T00:00:00Z`).getTime(),
    { message: "endDate must be on or after startDate", path: ["payload", "endDate"] }
  );

export type ModelAddBlackoutCommand = z.infer<typeof modelAddBlackoutCommandSchema>;

export const modelUpdateBlackoutWindowCommandSchema = z
  .object({
    type: z.literal("update_blackout_window"),
    payload: z
      .object({
        target: modelBlackoutLocatorSchema,
        startDate: modelIsoDateSchema.nullable(),
        endDate: modelIsoDateSchema.nullable(),
        reason: z.string().nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ payload }) =>
      payload.startDate !== null || payload.endDate !== null || payload.reason !== null,
    { message: "At least one field besides target must be provided", path: ["payload"] },
  )
  .refine(({ payload }) => {
    if (payload.startDate && payload.endDate) {
      return new Date(`${payload.endDate}T00:00:00Z`).getTime() >= new Date(`${payload.startDate}T00:00:00Z`).getTime();
    }
    return true;
  }, {
    message: "endDate must be on or after startDate",
    path: ["payload", "endDate"],
  });

export type ModelUpdateBlackoutWindowCommand = z.infer<typeof modelUpdateBlackoutWindowCommandSchema>;

export const modelDeleteBlackoutWindowCommandSchema = z
  .object({
    type: z.literal("delete_blackout_window"),
    payload: z.object({ target: modelBlackoutLocatorSchema }).strict(),
  })
  .strict();

export type ModelDeleteBlackoutWindowCommand = z.infer<typeof modelDeleteBlackoutWindowCommandSchema>;

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

export const modelUpdateTaskFieldsCommandSchema = z
  .object({
    type: z.literal("update_task_fields"),
    payload: z
      .object({
        target: modelTaskLocatorSchema,
        title: z.string().min(1).nullable(),
        estimateHours: z.number().positive().nullable(),
        remainingHours: z.number().nonnegative().nullable(),
        dueDate: modelIsoDateSchema.nullable(),
        priority: modelPrioritySchema.nullable(),
        note: z.string().max(500).nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(({ payload }) => {
    const { title, estimateHours, remainingHours, dueDate, priority, note } = payload;
    return (
      title !== null ||
      estimateHours !== null ||
      remainingHours !== null ||
      dueDate !== null ||
      priority !== null ||
      note !== null
    );
  },
  {
    message: "At least one field besides target must be provided",
    path: ["payload"],
  });

export type ModelUpdateTaskFieldsCommand = z.infer<typeof modelUpdateTaskFieldsCommandSchema>;

export const modelRescheduleTaskCommandSchema = z
  .object({
    type: z.literal("reschedule_task"),
    payload: z
      .object({
        target: modelTaskLocatorSchema,
        dueDate: modelIsoDateSchema.nullable(),
        reason: z.string().max(300).nullable(),
      })
      .strict(),
  })
  .strict();

export type ModelRescheduleTaskCommand = z.infer<typeof modelRescheduleTaskCommandSchema>;

export const modelReprioritizeTaskCommandSchema = z
  .object({
    type: z.literal("reprioritize_task"),
    payload: z
      .object({
        target: modelTaskLocatorSchema,
        priority: modelPrioritySchema,
        reason: z.string().max(300).nullable(),
      })
      .strict(),
  })
  .strict();

export type ModelReprioritizeTaskCommand = z.infer<typeof modelReprioritizeTaskCommandSchema>;

const withReason = {
  reason: z.string().max(300).nullable(),
} as const;

export const modelPauseTaskCommandSchema = z
  .object({
    type: z.literal("pause_task"),
    payload: z.object({ target: modelTaskLocatorSchema, ...withReason }).strict(),
  })
  .strict();

export type ModelPauseTaskCommand = z.infer<typeof modelPauseTaskCommandSchema>;

export const modelResumeTaskCommandSchema = z
  .object({
    type: z.literal("resume_task"),
    payload: z.object({ target: modelTaskLocatorSchema, ...withReason }).strict(),
  })
  .strict();

export type ModelResumeTaskCommand = z.infer<typeof modelResumeTaskCommandSchema>;

export const modelDeleteTaskCommandSchema = z
  .object({
    type: z.literal("delete_task"),
    payload: z.object({ target: modelTaskLocatorSchema, ...withReason }).strict(),
  })
  .strict();

export type ModelDeleteTaskCommand = z.infer<typeof modelDeleteTaskCommandSchema>;

export const modelRestoreTaskCommandSchema = z
  .object({
    type: z.literal("restore_task"),
    payload: z.object({ target: modelTaskLocatorSchema }).strict(),
  })
  .strict();

export type ModelRestoreTaskCommand = z.infer<typeof modelRestoreTaskCommandSchema>;

const modelSplitPartSchema = z
  .object({
    title: z.string(),
    estimateHours: z.number().positive().nullable(),
    remainingHours: z.number().nonnegative().nullable(),
    dueDate: modelIsoDateSchema.nullable(),
    priority: modelPrioritySchema.nullable(),
    note: z.string().max(500).nullable(),
  })
  .strict()
  .refine(
    ({ estimateHours, remainingHours }) => estimateHours !== null || remainingHours !== null,
    { message: "estimateHours or remainingHours is required" },
  );

export const modelSplitTaskCommandSchema = z
  .object({
    type: z.literal("split_task"),
    payload: z
      .object({
        target: modelTaskLocatorSchema,
        parts: z.array(modelSplitPartSchema).min(2),
        reason: z.string().max(300).nullable(),
      })
      .strict(),
  })
  .strict();

export type ModelSplitTaskCommand = z.infer<typeof modelSplitTaskCommandSchema>;

export const modelMergeTasksCommandSchema = z
  .object({
    type: z.literal("merge_tasks"),
    payload: z
      .object({
        targets: z.array(modelTaskLocatorSchema).min(2),
        title: z.string(),
        estimateHours: z.number().positive().nullable(),
        remainingHours: z.number().nonnegative().nullable(),
        dueDate: modelIsoDateSchema.nullable(),
        priority: modelPrioritySchema.nullable(),
        note: z.string().max(500).nullable(),
      })
      .strict(),
  })
  .strict();

export type ModelMergeTasksCommand = z.infer<typeof modelMergeTasksCommandSchema>;

export const modelMarkTaskDoneCommandSchema = z
  .object({
    type: z.literal("mark_task_done"),
    payload: z
      .object({
        target: modelTaskLocatorSchema,
        note: z.string().max(500).nullable(),
      })
      .strict(),
  })
  .strict();

export type ModelMarkTaskDoneCommand = z.infer<typeof modelMarkTaskDoneCommandSchema>;

export const modelReopenTaskCommandSchema = z
  .object({
    type: z.literal("reopen_task"),
    payload: z
      .object({
        target: modelTaskLocatorSchema,
        remainingHours: z.number().positive(),
        note: z.string().max(500).nullable(),
      })
      .strict(),
  })
  .strict();

export type ModelReopenTaskCommand = z.infer<typeof modelReopenTaskCommandSchema>;

export const modelCommandSchema = z.discriminatedUnion("type", [
  modelCreateTasksCommandSchema,
  modelLogCompletionCommandSchema,
  modelShrinkTaskCommandSchema,
  modelAddBlackoutCommandSchema,
  modelUpdateBlackoutWindowCommandSchema,
  modelDeleteBlackoutWindowCommandSchema,
  modelAddUrgentTaskCommandSchema,
  modelUpdateTaskFieldsCommandSchema,
  modelRescheduleTaskCommandSchema,
  modelReprioritizeTaskCommandSchema,
  modelPauseTaskCommandSchema,
  modelResumeTaskCommandSchema,
  modelDeleteTaskCommandSchema,
  modelRestoreTaskCommandSchema,
  modelSplitTaskCommandSchema,
  modelMergeTasksCommandSchema,
  modelMarkTaskDoneCommandSchema,
  modelReopenTaskCommandSchema,
]);

export type ModelAiCommand = z.infer<typeof modelCommandSchema>;

export const modelCommandEnvelopeSchema = z
  .object({
    commands: z.array(modelCommandSchema),
  })
  .strict();

export type ModelAiCommandEnvelope = z.infer<typeof modelCommandEnvelopeSchema>;
