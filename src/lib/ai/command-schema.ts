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

const taskStatusSchema = z.enum(["active", "paused", "completed", "archived"]);

const taskLocatorSchema = z
  .object({
    taskId: z.string().optional(),
    title: z.string().min(1, "title is required when provided").optional(),
    fuzzyTitle: z.string().min(1, "fuzzyTitle must not be empty").optional(),
  })
  .refine(
    ({ taskId, title, fuzzyTitle }) => Boolean(taskId || title || fuzzyTitle),
    "taskId, title, or fuzzyTitle is required",
  );

const blackoutLocatorSchema = z
  .object({
    blackoutId: z.string().optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    fuzzyReason: z.string().min(1, "fuzzyReason must not be empty").optional(),
  })
  .refine(
    ({ blackoutId, startDate, endDate, fuzzyReason }) =>
      Boolean(blackoutId || fuzzyReason || (startDate && endDate)),
    "blackoutId, fuzzyReason, or both startDate and endDate are required",
  )
  .refine(
    ({ startDate, endDate }) => Boolean((!startDate && !endDate) || (startDate && endDate)),
    { message: "startDate and endDate must be provided together", path: ["startDate"] },
  )
  .refine(
    ({ startDate, endDate }) => {
      if (startDate && endDate) {
        return new Date(`${endDate}T00:00:00Z`).getTime() >= new Date(`${startDate}T00:00:00Z`).getTime();
      }
      return true;
    },
    { message: "endDate must be on or after startDate", path: ["endDate"] },
  );

// Read-only slice of the database the AI is allowed to see.
export const aiReadableTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  estimateMinutes: z.number().int().nonnegative(),
  actualMinutes: z.number().int().nonnegative().optional(),
  remainingMinutes: z.number().int().nonnegative().optional(),
  dueDate: isoDateSchema.optional(),
  plannedDate: isoDateSchema.optional(),
  priority: z.number().int(),
  locked: z.boolean(),
  note: z.string().max(500).optional(),
});

export type AiReadableTask = z.infer<typeof aiReadableTaskSchema>;

export const aiReadableBlackoutSchema = z
  .object({
    id: z.string().optional(),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
    reason: z.string().min(1, "Reason is required"),
  })
  .refine(({ start, end }) => new Date(end).getTime() > new Date(start).getTime(), {
    message: "blackout end must be after start",
    path: ["end"],
  });

export type AiReadableBlackout = z.infer<typeof aiReadableBlackoutSchema>;

export const aiReadableContextSchema = z.object({
  todayLocalDate: isoDateSchema.optional(),
  timezone: z.string().min(1, "Timezone is required").optional(),
  dailyCapacityHours: z.number().nonnegative().optional(),
  blackouts: z.array(aiReadableBlackoutSchema).default([]),
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
      markDone: z.boolean(),
      note: z.string().max(500).optional(),
      loggedAt: isoDateTimeSchema.optional(),
    }),
  })
  .refine(({ payload }) => Boolean(payload.taskId || payload.title), {
    message: "Either taskId or title is required",
    path: ["payload", "taskId"],
  })
  .refine(({ payload }) => payload.minutesSpent !== undefined || payload.markDone === true, {
    message: "minutesSpent may be omitted only when markDone is true",
    path: ["payload", "minutesSpent"],
  });

export type LogCompletionCommand = z.infer<typeof logCompletionCommandSchema>;

export const shrinkTaskCommandSchema = z
  .object({
    type: z.literal("shrink_task"),
    payload: z.object({
      taskId: z.string(),
      newRemainingMinutes: z.number().int().nonnegative(),
      previousEstimateMinutes: z.number().int().positive().optional(),
      reason: z.string().max(300).optional(),
    }),
  })
  .refine(
    ({ payload }) =>
      payload.previousEstimateMinutes === undefined ||
      payload.newRemainingMinutes <= payload.previousEstimateMinutes,
    {
      message: "newRemainingMinutes must be <= previousEstimateMinutes",
      path: ["payload", "newRemainingMinutes"],
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

export const updateBlackoutWindowCommandSchema = z
  .object({
    type: z.literal("update_blackout_window"),
    payload: z.object({
      target: blackoutLocatorSchema,
      startDate: isoDateSchema.optional(),
      endDate: isoDateSchema.optional(),
      reason: z.string().min(1, "Reason is required").optional(),
    }),
  })
  .refine(
    ({ payload }) =>
      payload.startDate !== undefined ||
      payload.endDate !== undefined ||
      payload.reason !== undefined,
    { message: "At least one field besides target must be provided", path: ["payload"] },
  )
  .refine(
    ({ payload }) => {
      const { startDate, endDate } = payload;
      if (startDate && endDate) {
        return new Date(`${endDate}T00:00:00Z`).getTime() >= new Date(`${startDate}T00:00:00Z`).getTime();
      }
      return true;
    },
    { message: "endDate must be on or after startDate", path: ["payload", "endDate"] },
  );

export type UpdateBlackoutWindowCommand = z.infer<typeof updateBlackoutWindowCommandSchema>;

export const deleteBlackoutWindowCommandSchema = z.object({
  type: z.literal("delete_blackout_window"),
  payload: z.object({
    target: blackoutLocatorSchema,
  }),
});

export type DeleteBlackoutWindowCommand = z.infer<typeof deleteBlackoutWindowCommandSchema>;

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

export const updateTaskFieldsCommandSchema = z
  .object({
    type: z.literal("update_task_fields"),
    payload: z.object({
      target: taskLocatorSchema,
      title: z.string().min(1, "Title is required").optional(),
      estimateMinutes: z.number().int().positive().optional(),
      remainingMinutes: z.number().int().nonnegative().optional(),
      dueDate: isoDateSchema.nullable().optional(),
      priority: z.number().int().positive().optional(),
      note: z.string().max(500).nullable().optional(),
    }),
  })
  .refine(({ payload }) => {
    const { title, estimateMinutes, remainingMinutes, dueDate, priority, note } = payload;
    return (
      title !== undefined ||
      estimateMinutes !== undefined ||
      remainingMinutes !== undefined ||
      dueDate !== undefined ||
      priority !== undefined ||
      note !== undefined
    );
  },
  {
    message: "At least one field besides target must be provided",
    path: ["payload"],
  });

export type UpdateTaskFieldsCommand = z.infer<typeof updateTaskFieldsCommandSchema>;

export const rescheduleTaskCommandSchema = z.object({
  type: z.literal("reschedule_task"),
  payload: z.object({
    target: taskLocatorSchema,
    dueDate: isoDateSchema.nullable(),
    reason: z.string().max(300).optional(),
  }),
});

export type RescheduleTaskCommand = z.infer<typeof rescheduleTaskCommandSchema>;

export const reprioritizeTaskCommandSchema = z.object({
  type: z.literal("reprioritize_task"),
  payload: z.object({
    target: taskLocatorSchema,
    priority: z.number().int().positive(),
    reason: z.string().max(300).optional(),
  }),
});

export type ReprioritizeTaskCommand = z.infer<typeof reprioritizeTaskCommandSchema>;

export const pauseTaskCommandSchema = z.object({
  type: z.literal("pause_task"),
  payload: z.object({
    target: taskLocatorSchema,
    reason: z.string().max(300).optional(),
  }),
});

export type PauseTaskCommand = z.infer<typeof pauseTaskCommandSchema>;

export const resumeTaskCommandSchema = z.object({
  type: z.literal("resume_task"),
  payload: z.object({
    target: taskLocatorSchema,
    reason: z.string().max(300).optional(),
  }),
});

export type ResumeTaskCommand = z.infer<typeof resumeTaskCommandSchema>;

export const deleteTaskCommandSchema = z.object({
  type: z.literal("delete_task"),
  payload: z.object({
    target: taskLocatorSchema,
    reason: z.string().max(300).optional(),
  }),
});

export type DeleteTaskCommand = z.infer<typeof deleteTaskCommandSchema>;

export const restoreTaskCommandSchema = z.object({
  type: z.literal("restore_task"),
  payload: z.object({
    target: taskLocatorSchema,
  }),
});

export type RestoreTaskCommand = z.infer<typeof restoreTaskCommandSchema>;

const splitPartSchema = z
  .object({
    title: z.string().min(1, "Child task title is required"),
    estimateMinutes: z.number().int().positive().optional(),
    remainingMinutes: z.number().int().nonnegative().optional(),
    dueDate: isoDateSchema.nullable().optional(),
    priority: z.number().int().positive().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine(
    ({ estimateMinutes, remainingMinutes }) =>
      estimateMinutes !== undefined || remainingMinutes !== undefined,
    { message: "estimateMinutes or remainingMinutes is required for split tasks" },
  );

export const splitTaskCommandSchema = z.object({
  type: z.literal("split_task"),
  payload: z.object({
    target: taskLocatorSchema,
    parts: z.array(splitPartSchema).min(2, "At least two parts are required"),
    reason: z.string().max(300).optional(),
  }),
});

export type SplitTaskCommand = z.infer<typeof splitTaskCommandSchema>;

export const mergeTasksCommandSchema = z.object({
  type: z.literal("merge_tasks"),
  payload: z.object({
    targets: z.array(taskLocatorSchema).min(2, "At least two tasks must be merged"),
    title: z.string().min(1, "Merged task title is required"),
    estimateMinutes: z.number().int().positive().optional(),
    remainingMinutes: z.number().int().nonnegative().optional(),
    dueDate: isoDateSchema.nullable().optional(),
    priority: z.number().int().positive().optional(),
    note: z.string().max(500).nullable().optional(),
  }),
});

export type MergeTasksCommand = z.infer<typeof mergeTasksCommandSchema>;

export const markTaskDoneCommandSchema = z.object({
  type: z.literal("mark_task_done"),
  payload: z.object({
    target: taskLocatorSchema,
    note: z.string().max(500).nullable().optional(),
  }),
});

export type MarkTaskDoneCommand = z.infer<typeof markTaskDoneCommandSchema>;

export const reopenTaskCommandSchema = z.object({
  type: z.literal("reopen_task"),
  payload: z.object({
    target: taskLocatorSchema,
    remainingMinutes: z.number().int().positive(),
    note: z.string().max(500).nullable().optional(),
  }),
});

export type ReopenTaskCommand = z.infer<typeof reopenTaskCommandSchema>;

export const aiCommandSchema = z.discriminatedUnion("type", [
  createTasksCommandSchema,
  logCompletionCommandSchema,
  shrinkTaskCommandSchema,
  addBlackoutCommandSchema,
  updateBlackoutWindowCommandSchema,
  deleteBlackoutWindowCommandSchema,
  addUrgentTaskCommandSchema,
  updateTaskFieldsCommandSchema,
  rescheduleTaskCommandSchema,
  reprioritizeTaskCommandSchema,
  pauseTaskCommandSchema,
  resumeTaskCommandSchema,
  deleteTaskCommandSchema,
  restoreTaskCommandSchema,
  splitTaskCommandSchema,
  mergeTasksCommandSchema,
  markTaskDoneCommandSchema,
  reopenTaskCommandSchema,
]);

export type AiCommand = z.infer<typeof aiCommandSchema>;

export const aiCommandBatchSchema = z.array(aiCommandSchema);

export type AiCommandBatch = z.infer<typeof aiCommandBatchSchema>;

export type TaskLocator = z.infer<typeof taskLocatorSchema>;
export type BlackoutLocator = z.infer<typeof blackoutLocatorSchema>;
