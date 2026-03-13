import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchModelCommands,
  InputMessage,
  plannerCommandsJsonSchema,
  coerceDateOnlyFields,
} from "../openai-responses";
import { modelCommandEnvelopeSchema } from "../model-command-schema";

const constructorSpy = vi.fn();
const parseMock = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    public responses = { parse: parseMock };

    constructor(config: unknown) {
      constructorSpy(config);
    }
  }

  return { default: MockOpenAI };
});

describe("fetchModelCommands", () => {
  const messages: InputMessage[] = [
    { role: "system", content: "You are a planner" },
    { role: "user", content: "Plan my day" },
  ];

  type SchemaVariant = {
    properties?: {
      type?: { enum?: readonly string[] };
      payload?: { properties?: Record<string, unknown> };
    };
  };

  const commandVariants =
    plannerCommandsJsonSchema.properties.commands.items.anyOf as ReadonlyArray<SchemaVariant>;

  const getCommandVariant = (type: string): SchemaVariant | undefined =>
    commandVariants.find((variant) => variant.properties?.type?.enum?.includes(type));

  const assertNoOneOf = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(assertNoOneOf);
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        expect(key).not.toBe("oneOf");
        assertNoOneOf(nested);
      }
    }
  };

  it("uses a hand-written JSON schema without any oneOf branches", () => {
    assertNoOneOf(plannerCommandsJsonSchema);
  });

  it("keeps root object constraints and anyOf command variants", () => {
    expect(plannerCommandsJsonSchema.type).toBe("object");
    expect(plannerCommandsJsonSchema.additionalProperties).toBe(false);

    const commands = plannerCommandsJsonSchema.properties.commands;
    expect(commands.type).toBe("array");

    const items = commands.items;
    expect(items).toBeTruthy();
    expect(items.anyOf).toBeInstanceOf(Array);
    assertNoOneOf(items);
  });

  it("marks date-only fields with ISO date constraints", () => {
    const blackoutPayload = getCommandVariant("add_blackout")?.properties?.payload?.properties as
      | Record<string, { format?: string; pattern?: string }>
      | undefined;
    expect(blackoutPayload?.startDate).toMatchObject({
      format: "date",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    });
    expect(blackoutPayload?.endDate).toMatchObject({
      format: "date",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    });

    const urgent = getCommandVariant("add_urgent_task")?.properties?.payload?.properties as
      | Record<string, { format?: string }>
      | undefined;
    const urgentDueDate = urgent?.dueDate;
    expect(urgentDueDate).toMatchObject({ format: "date" });
  });

  it("uses integer types for minute and window fields", () => {
    const createTasksPayload = getCommandVariant("create_tasks")?.properties?.payload
      ?.properties as
        | Record<string, { items?: { properties?: Record<string, { type?: string }> } }>
        | undefined;
    const createTasksProps = createTasksPayload?.tasks?.items?.properties;
    expect(createTasksProps?.estimateMinutes?.type).toBe("integer");

    const logCompletionMinutes =
      getCommandVariant("log_completion")?.properties?.payload?.properties?.minutesSpent as
        | { anyOf?: Array<{ type?: string }> }
        | undefined;
    expect(logCompletionMinutes?.anyOf?.[0]?.type).toBe("integer");

    const shrinkTaskRemaining =
      getCommandVariant("shrink_task")?.properties?.payload?.properties
        ?.newRemainingMinutes as { type?: string; minimum?: number } | undefined;
    expect(shrinkTaskRemaining?.type).toBe("integer");
    expect(shrinkTaskRemaining?.minimum).toBe(0);

    const urgentTaskProps =
      getCommandVariant("add_urgent_task")?.properties?.payload?.properties as
        | Record<string, { type?: string }>
        | undefined;
    expect(urgentTaskProps?.estimateMinutes?.type).toBe("integer");
    expect(urgentTaskProps?.windowDays?.type).toBe("integer");
  });

  describe("date-only coercion", () => {
    it("trims ISO datetimes down to YYYY-MM-DD for date-only fields", () => {
      const raw = {
        commands: [
          {
            type: "add_blackout",
            payload: {
              startDate: "2026-03-20T00:00:00Z",
              endDate: "2026-03-21 12:34:56+11:00",
              reason: "Trip",
            },
          },
        ],
      } as const;

      const coerced = coerceDateOnlyFields(raw);
      expect(coerced.commands[0].payload.startDate).toBe("2026-03-20");
      expect(coerced.commands[0].payload.endDate).toBe("2026-03-21");
      expect(() => modelCommandEnvelopeSchema.parse(coerced)).not.toThrow();
    });

    it("leaves natural language dates unchanged so validation still fails", () => {
      const raw = {
        commands: [
          {
            type: "add_blackout",
            payload: {
              startDate: "next Friday",
              endDate: "next Friday",
              reason: "vague",
            },
          },
        ],
      } as const;

      const coerced = coerceDateOnlyFields(raw);
      expect(coerced.commands[0].payload.startDate).toBe("next Friday");
      expect(() => modelCommandEnvelopeSchema.parse(coerced)).toThrow();
    });
  });

  beforeEach(() => {
    constructorSpy.mockReset();
    parseMock.mockReset();
    vi.clearAllMocks();
  });

  it("builds OpenAI client, calls responses.parse once, and returns envelope with raw response", async () => {
    const envelope = { commands: [] };
    const rawResponse = { output_parsed: envelope, id: "resp_test" };
    parseMock.mockResolvedValueOnce(rawResponse);

    const result = await fetchModelCommands({
      apiKey: "test-api-key",
      model: "gpt-4.1",
      messages,
    });

    expect(constructorSpy).toHaveBeenCalledWith({ apiKey: "test-api-key" });
    expect(parseMock).toHaveBeenCalledTimes(1);

    const callArgs = parseMock.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      model: "gpt-4.1",
      input: messages,
      store: false,
    });
    expect(callArgs.text?.format).toBeDefined();

    expect(result.envelope).toEqual(envelope);
    expect(result.raw).toBe(rawResponse);
  });

  it("forwards abortSignal to responses.parse", async () => {
    const envelope = { commands: [] };
    const rawResponse = { output_parsed: envelope };
    const controller = new AbortController();
    parseMock.mockResolvedValueOnce(rawResponse);

    await fetchModelCommands({
      apiKey: "signal-key",
      model: "planner-model",
      messages,
      abortSignal: controller.signal,
    });

    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(parseMock.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it("rethrows errors from responses.parse", async () => {
    const parseError = new Error("parse failed");
    parseMock.mockRejectedValueOnce(parseError);

    await expect(
      fetchModelCommands({ apiKey: "key", model: "model", messages })
    ).rejects.toThrow(parseError);
  });

  it("throws when output_parsed fails modelCommandEnvelopeSchema validation", async () => {
    parseMock.mockResolvedValueOnce({ output_parsed: { commands: "not-an-array" } });

    await expect(
      fetchModelCommands({ apiKey: "key", model: "model", messages })
    ).rejects.toThrow(/commands/i);
  });
});
