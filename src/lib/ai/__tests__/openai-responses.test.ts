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

describe("plannerCommandsJsonSchema", () => {
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

  it("uses strict object schemas without oneOf branches", () => {
    assertNoOneOf(plannerCommandsJsonSchema);
  });

  it("marks every object schema as strict with matching required keys", () => {
    const visit = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }

      if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (obj.type === "object") {
          expect(obj.additionalProperties).toBe(false);
          const properties = (obj.properties ?? {}) as Record<string, unknown>;
          const required = obj.required as string[] | undefined;
          expect(Array.isArray(required)).toBe(true);
          const sortedRequired = [...(required ?? [])].sort();
          const sortedKeys = Object.keys(properties).sort();
          expect(sortedRequired).toEqual(sortedKeys);
        }

        Object.values(obj).forEach(visit);
      }
    };

    visit(plannerCommandsJsonSchema);
  });

  it("includes new edit commands", () => {
    expect(getCommandVariant("update_task_fields")).toBeTruthy();
    expect(getCommandVariant("reprioritize_task")).toBeTruthy();
    expect(getCommandVariant("merge_tasks")).toBeTruthy();
    expect(getCommandVariant("update_blackout_window")).toBeTruthy();
    expect(getCommandVariant("delete_blackout_window")).toBeTruthy();
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

    const reschedule = getCommandVariant("reschedule_task")?.properties?.payload?.properties as
      | Record<string, { format?: string }>
      | undefined;
    const dueDateSchema = reschedule?.dueDate as { anyOf?: Array<Record<string, unknown>> };
    expect(dueDateSchema?.anyOf?.[0]).toMatchObject({ format: "date" });
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
          {
            type: "reschedule_task",
            payload: {
              target: { taskId: "task-1", title: null, fuzzyTitle: null },
              dueDate: "2026-03-22T10:00:00Z",
              reason: null,
            },
          },
          {
            type: "update_blackout_window",
            payload: {
              target: {
                blackoutId: null,
                startDate: "2026-03-19T09:00:00Z",
                endDate: "2026-03-21T07:00:00Z",
                fuzzyReason: null,
              },
              startDate: "2026-03-19T08:00:00Z",
              endDate: null,
              reason: "调整",
            },
          },
        ],
      } as const;

      const coerced = coerceDateOnlyFields(raw);
      expect(coerced.commands[0].payload.startDate).toBe("2026-03-20");
      expect(coerced.commands[0].payload.endDate).toBe("2026-03-21");
      expect(coerced.commands[1].payload.dueDate).toBe("2026-03-22");
      expect(coerced.commands[2].payload.startDate).toBe("2026-03-19");
      expect(coerced.commands[2].payload.target.startDate).toBe("2026-03-19");
      expect(coerced.commands[2].payload.target.endDate).toBe("2026-03-21");
      expect(() => modelCommandEnvelopeSchema.parse(coerced)).not.toThrow();
    });
  });
});

describe("fetchModelCommands", () => {
  const messages: InputMessage[] = [
    { role: "system", content: "You are a planner" },
    { role: "user", content: "Plan my day" },
  ];

  beforeEach(() => {
    constructorSpy.mockReset();
    parseMock.mockReset();
  });

  it("passes apiKey and model into OpenAI client", async () => {
    parseMock.mockResolvedValue({ output_parsed: { commands: [] } });

    await fetchModelCommands({
      apiKey: "key",
      model: "model",
      messages,
    });

    expect(constructorSpy).toHaveBeenCalledWith({ apiKey: "key" });
    expect(parseMock).toHaveBeenCalled();
  });

  it("throws when output_parsed fails modelCommandEnvelopeSchema validation", async () => {
    parseMock.mockResolvedValue({ output_parsed: { bad: true } });

    await expect(
      fetchModelCommands({ apiKey: "key", model: "model", messages })
    ).rejects.toThrow();
  });
});
