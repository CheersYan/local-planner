import OpenAI from "openai";
import { makeParseableTextFormat } from "openai/lib/parser";

import { modelCommandEnvelopeSchema, ModelAiCommandEnvelope } from "./model-command-schema";

const isoDateString = {
  type: "string",
  format: "date",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description:
    "ISO 8601 date-only string (YYYY-MM-DD). Do not include time, timezone, ranges, or prose.",
} as const;

const nullableIsoDateString = {
  anyOf: [isoDateString, { type: "null" }],
} as const;

const isoDateTimeString = {
  type: "string",
  format: "date-time",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
  description: "ISO 8601 datetime with timezone (e.g. 2026-03-13T10:00:00Z)",
} as const;

const positiveInt = { type: "integer", minimum: 1 } as const;
const nonNegativeInt = { type: "integer", minimum: 0 } as const;
const positiveNumber = { type: "number", exclusiveMinimum: 0 } as const;
const nonNegativeNumber = { type: "number", minimum: 0 } as const;
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

const strictObject = <T extends Record<string, unknown>>(properties: T) => ({
  type: "object" as const,
  additionalProperties: false as const,
  properties,
  required: Object.keys(properties) as Array<keyof T & string>,
});

const nullablePositiveInt = { anyOf: [positiveInt, { type: "null" }] } as const;
const nullablePositiveNumber = { anyOf: [positiveNumber, { type: "null" }] } as const;
const nullableNonNegativeNumber = { anyOf: [nonNegativeNumber, { type: "null" }] } as const;
const nullablePriority = {
  anyOf: [
    { type: "string", enum: ["low", "medium", "high", "urgent"] },
    { type: "null" },
  ],
} as const;
const nullableNote = {
  anyOf: [
    { type: "string", maxLength: 500 },
    { type: "null" },
  ],
} as const;
const nullableReason = {
  anyOf: [
    { type: "string", maxLength: 300 },
    { type: "null" },
  ],
} as const;

const taskLocatorJson = strictObject({
  taskId: nullableString,
  title: nullableString,
  fuzzyTitle: nullableString,
});

const blackoutLocatorJson = strictObject({
  blackoutId: nullableString,
  startDate: nullableIsoDateString,
  endDate: nullableIsoDateString,
  fuzzyReason: nullableString,
});

const splitPartJson = strictObject({
  title: { type: "string" },
  estimateHours: nullablePositiveNumber,
  remainingHours: nullableNonNegativeNumber,
  dueDate: nullableIsoDateString,
  priority: nullablePriority,
  note: nullableNote,
});

export type InputMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ParsedModelCommands = {
  envelope: ModelAiCommandEnvelope;
  raw: unknown;
};

export const plannerCommandsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    commands: {
      type: "array",
      items: {
        anyOf: [
          strictObject({
            type: { type: "string", enum: ["create_tasks"] },
            payload: strictObject({
              tasks: {
                type: "array",
                minItems: 1,
                items: strictObject({
                  title: { type: "string" },
                  estimateMinutes: positiveInt,
                  dueDate: nullableIsoDateString,
                  priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
                  locked: { type: "boolean" },
                  note: nullableNote,
                }),
              },
              requestId: nullableString,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["log_completion"] },
            payload: strictObject({
              taskId: nullableString,
              title: nullableString,
              minutesSpent: { anyOf: [positiveInt, { type: "null" }] },
              markDone: { type: "boolean" },
              note: nullableNote,
              loggedAt: { anyOf: [isoDateTimeString, { type: "null" }] },
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["shrink_task"] },
            payload: strictObject({
              taskId: { type: "string" },
              newRemainingMinutes: nonNegativeInt,
              previousEstimateMinutes: nullablePositiveInt,
              reason: nullableReason,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["add_blackout"] },
            payload: strictObject({
              startDate: isoDateString,
              endDate: isoDateString,
              reason: { type: "string" },
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["update_blackout_window"] },
            payload: strictObject({
              target: blackoutLocatorJson,
              startDate: nullableIsoDateString,
              endDate: nullableIsoDateString,
              reason: nullableString,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["delete_blackout_window"] },
            payload: strictObject({
              target: blackoutLocatorJson,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["add_urgent_task"] },
            payload: strictObject({
              title: { type: "string" },
              estimateMinutes: positiveInt,
              dueDate: isoDateString,
              priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
              windowDays: positiveInt,
              note: nullableNote,
              reason: nullableReason,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["update_task_fields"] },
            payload: strictObject({
              target: taskLocatorJson,
              title: nullableString,
              estimateHours: nullablePositiveNumber,
              remainingHours: nullableNonNegativeNumber,
              dueDate: nullableIsoDateString,
              priority: nullablePriority,
              note: nullableNote,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["reschedule_task"] },
            payload: strictObject({
              target: taskLocatorJson,
              dueDate: nullableIsoDateString,
              reason: nullableReason,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["reprioritize_task"] },
            payload: strictObject({
              target: taskLocatorJson,
              priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
              reason: nullableReason,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["pause_task"] },
            payload: strictObject({
              target: taskLocatorJson,
              reason: nullableReason,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["resume_task"] },
            payload: strictObject({
              target: taskLocatorJson,
              reason: nullableReason,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["delete_task"] },
            payload: strictObject({
              target: taskLocatorJson,
              reason: nullableReason,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["restore_task"] },
            payload: strictObject({
              target: taskLocatorJson,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["split_task"] },
            payload: strictObject({
              target: taskLocatorJson,
              parts: {
                type: "array",
                minItems: 2,
                items: splitPartJson,
              },
              reason: nullableReason,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["merge_tasks"] },
            payload: strictObject({
              targets: {
                type: "array",
                minItems: 2,
                items: taskLocatorJson,
              },
              title: { type: "string" },
              estimateHours: nullablePositiveNumber,
              remainingHours: nullableNonNegativeNumber,
              dueDate: nullableIsoDateString,
              priority: nullablePriority,
              note: nullableNote,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["mark_task_done"] },
            payload: strictObject({
              target: taskLocatorJson,
              note: nullableNote,
            }),
          }),
          strictObject({
            type: { type: "string", enum: ["reopen_task"] },
            payload: strictObject({
              target: taskLocatorJson,
              remainingHours: nonNegativeNumber,
              note: nullableNote,
            }),
          }),
        ],
      },
    },
  },
  required: ["commands"],
} as const;

const dateOnlyKeys = new Set(["startDate", "endDate", "dueDate", "plannedDate"]);

export const coerceDateOnlyFields = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => coerceDateOnlyFields(item)) as unknown as T;
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (dateOnlyKeys.has(key) && typeof nested === "string") {
        const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(nested.trim());
        result[key] = match ? match[1] : nested;
        continue;
      }

      result[key] = coerceDateOnlyFields(nested);
    }

    return result as unknown as T;
  }

  return value;
};

const parsePlannerEnvelope = (input: unknown): ModelAiCommandEnvelope =>
  modelCommandEnvelopeSchema.parse(coerceDateOnlyFields(input));

const plannerCommandsTextFormat = makeParseableTextFormat<ModelAiCommandEnvelope>(
  {
    type: "json_schema",
    name: "planner_commands",
    strict: true,
    schema: plannerCommandsJsonSchema,
  },
  (content) => parsePlannerEnvelope(JSON.parse(content))
);

export const fetchModelCommands = async (params: {
  apiKey: string;
  model: string;
  messages: InputMessage[];
  abortSignal?: AbortSignal;
}): Promise<ParsedModelCommands> => {
  const { apiKey, model, messages, abortSignal } = params;
  const client = new OpenAI({ apiKey });

  const response = await client.responses.parse({
    model,
    input: messages,
    store: false,
    signal: abortSignal,
    text: {
      format: plannerCommandsTextFormat,
    },
  });

  const envelope = parsePlannerEnvelope(response.output_parsed);
  return { envelope, raw: response };
};
