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
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

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
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["create_tasks"] },
              payload: {
                type: "object",
                additionalProperties: false,
                properties: {
                  tasks: {
                    type: "array",
                    minItems: 1,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        title: { type: "string" },
                        estimateMinutes: positiveInt,
                        dueDate: nullableIsoDateString,
                        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
                        locked: { type: "boolean" },
                        note: {
                          anyOf: [
                            { type: "string", maxLength: 500 },
                            { type: "null" },
                          ],
                        },
                      },
                      required: [
                        "title",
                        "estimateMinutes",
                        "dueDate",
                        "priority",
                        "locked",
                        "note",
                      ],
                    },
                  },
                  requestId: nullableString,
                },
                required: ["tasks", "requestId"],
              },
            },
            required: ["type", "payload"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["log_completion"] },
              payload: {
                type: "object",
                additionalProperties: false,
                properties: {
                  taskId: nullableString,
                  title: nullableString,
                  minutesSpent: { anyOf: [positiveInt, { type: "null" }] },
                  markDone: { type: "boolean" },
                  note: {
                    anyOf: [
                      { type: "string", maxLength: 500 },
                      { type: "null" },
                    ],
                  },
                  loggedAt: { anyOf: [isoDateTimeString, { type: "null" }] },
                },
                required: [
                  "taskId",
                  "title",
                  "minutesSpent",
                  "markDone",
                  "note",
                  "loggedAt",
                ],
              },
            },
            required: ["type", "payload"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["shrink_task"] },
              payload: {
                type: "object",
                additionalProperties: false,
                properties: {
                  taskId: { type: "string" },
                  newRemainingMinutes: nonNegativeInt,
                  previousEstimateMinutes: { anyOf: [positiveInt, { type: "null" }] },
                  reason: {
                    anyOf: [
                      { type: "string", maxLength: 300 },
                      { type: "null" },
                    ],
                  },
                },
                required: [
                  "taskId",
                  "newRemainingMinutes",
                  "previousEstimateMinutes",
                  "reason",
                ],
              },
            },
            required: ["type", "payload"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["add_blackout"] },
              payload: {
                type: "object",
                additionalProperties: false,
                properties: {
                  startDate: isoDateString,
                  endDate: isoDateString,
                  reason: { type: "string" },
                },
                required: ["startDate", "endDate", "reason"],
              },
            },
            required: ["type", "payload"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["add_urgent_task"] },
              payload: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  estimateMinutes: positiveInt,
                  dueDate: isoDateString,
                  priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
                  windowDays: positiveInt,
                  note: {
                    anyOf: [
                      { type: "string", maxLength: 500 },
                      { type: "null" },
                    ],
                  },
                  reason: {
                    anyOf: [
                      { type: "string", maxLength: 300 },
                      { type: "null" },
                    ],
                  },
                },
                required: [
                  "title",
                  "estimateMinutes",
                  "dueDate",
                  "priority",
                  "windowDays",
                  "note",
                  "reason",
                ],
              },
            },
            required: ["type", "payload"],
          },
        ],
      },
    },
  },
  required: ["commands"],
} as const;

const dateOnlyKeys = new Set(["startDate", "endDate", "dueDate"]);

export const coerceDateOnlyFields = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => coerceDateOnlyFields(item)) as unknown as T;
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (dateOnlyKeys.has(key) && typeof nested === "string") {
        const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?=[T\s])/.exec(nested);
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
