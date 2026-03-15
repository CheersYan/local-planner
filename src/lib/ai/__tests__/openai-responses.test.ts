import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import {
  fetchModelCommands,
  InputMessage,
  plannerCommandsJsonSchema,
  coerceDateOnlyFields,
} from "../openai-responses";
import { modelCommandEnvelopeSchema } from "../model-command-schema";

const constructorSpy = vi.fn();
const parseMock = vi.fn();
const withResponseMock = vi.fn();
let infoSpy: MockInstance<Parameters<typeof console.info>, ReturnType<typeof console.info>>;
let debugSpy: MockInstance<Parameters<typeof console.debug>, ReturnType<typeof console.debug>>;

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

const originalEnv = {
  OPENAI_RESPONSE_STORE: process.env.OPENAI_RESPONSE_STORE,
  OPENAI_LOG: process.env.OPENAI_LOG,
  OPENAI_RESPONSE_DEBUG: process.env.OPENAI_RESPONSE_DEBUG,
  OPENAI_PROJECT: process.env.OPENAI_PROJECT,
  OPENAI_ORGANIZATION: process.env.OPENAI_ORGANIZATION,
  OPENAI_ORG: process.env.OPENAI_ORG,
  OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
} as const;

const restoreEnvVar = (key: keyof typeof originalEnv, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

  const makeHeaders = () => new Headers({ "x-request-id": "req-123" });

  const mockParsedResponse = (overrides: Record<string, unknown> = {}) => {
    withResponseMock.mockResolvedValue({
      data: {
        id: "resp_123",
        model: "gpt-4.1-mini",
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        output_parsed: { commands: [] },
        ...overrides,
      },
      response: new Response("{}", { status: 200, headers: makeHeaders() }),
      request_id: "req-123",
    });

    parseMock.mockReturnValue({ withResponse: withResponseMock });
  };

  beforeEach(() => {
    constructorSpy.mockReset();
    parseMock.mockReset();
    withResponseMock.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("client-uuid");
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    (Object.keys(originalEnv) as Array<keyof typeof originalEnv>).forEach((key) => {
      restoreEnvVar(key, originalEnv[key]);
    });
  });

  it("sets store, metadata, and client request id headers", async () => {
    mockParsedResponse();

    await fetchModelCommands({
      apiKey: "key",
      model: "model",
      messages,
      chatId: "chat-123",
    });

    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: "key",
      logLevel: undefined,
      defaultHeaders: { "X-Client-Request-Id": "client-uuid" },
    });

    expect(parseMock).toHaveBeenCalledTimes(1);
    const [body, options] = parseMock.mock.calls[0] as [
      { store?: boolean; metadata?: Record<string, string> },
      { headers?: Record<string, string> }
    ];

    expect(body.store).toBe(true);
    expect(body.metadata).toMatchObject({
      app: "local-planner",
      workflow: "parse_commands",
      route: "api_ai_parse",
      env: expect.any(String),
      chat_id: "chat-123",
    });
    expect(options?.headers).toMatchObject({
      "X-Client-Request-Id": "client-uuid",
    });
    expect(withResponseMock).toHaveBeenCalled();
  });

  it("forces store=true and forwards project/org headers when configured", async () => {
    process.env.OPENAI_RESPONSE_STORE = "false";
    process.env.OPENAI_PROJECT = "proj_123";
    process.env.OPENAI_ORGANIZATION = "org_456";
    mockParsedResponse();

    await fetchModelCommands({
      apiKey: "key",
      model: "model",
      messages,
      chatId: "chat-123",
    });

    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: "key",
      logLevel: undefined,
      defaultHeaders: {
        "X-Client-Request-Id": "client-uuid",
        "OpenAI-Project": "proj_123",
        "OpenAI-Organization": "org_456",
      },
    });

    const [body, options] = parseMock.mock.calls[0] as [
      { store?: boolean },
      { headers?: Record<string, string> }
    ];

    expect(body.store).toBe(true);
    expect(options?.headers).toMatchObject({
      "X-Client-Request-Id": "client-uuid",
      "OpenAI-Project": "proj_123",
      "OpenAI-Organization": "org_456",
    });
  });

  it("returns trace ids, logs them, and avoids leaking the API key", async () => {
    mockParsedResponse();

    const result = await fetchModelCommands({
      apiKey: "super-secret-key",
      model: "model",
      messages,
      chatId: "chat-456",
    });

    expect(result.trace).toMatchObject({
      clientRequestId: "client-uuid",
      openaiResponseId: "resp_123",
      xRequestId: "req-123",
      model: "gpt-4.1-mini",
    });

    expect(infoSpy).toHaveBeenCalledWith(
      "openai.response",
      expect.objectContaining({ openaiResponseId: "resp_123" })
    );

    const serializedLogs = JSON.stringify(infoSpy.mock.calls);
    expect(serializedLogs).not.toContain("super-secret-key");
  });

  it("emits debug logs only when OPENAI_RESPONSE_DEBUG is true", async () => {
    process.env.OPENAI_RESPONSE_DEBUG = "true";
    mockParsedResponse();

    await fetchModelCommands({
      apiKey: "key",
      model: "model",
      messages,
      chatId: "chat-789",
    });

    expect(debugSpy).toHaveBeenCalledWith(
      "openai.response.debug",
      expect.objectContaining({ status: 200 })
    );
  });

  it("throws when output_parsed fails modelCommandEnvelopeSchema validation", async () => {
    mockParsedResponse({ output_parsed: { bad: true } });

    await expect(
      fetchModelCommands({ apiKey: "key", model: "model", messages, chatId: "chat-err" })
    ).rejects.toThrow();
  });
});
