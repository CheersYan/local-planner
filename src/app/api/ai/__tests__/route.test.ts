import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { InputMessage } from "@/lib/ai/openai-responses";

const mockFetchModelCommands = vi.fn();
const mockNormalizeModelEnvelope = vi.fn();

const originalEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_API_KEY_REAL_TEST: process.env.OPENAI_API_KEY_REAL_TEST,
  OPENAI_MODEL_REAL_TEST: process.env.OPENAI_MODEL_REAL_TEST,
  RUN_OPENAI_ROUTE_TEST: process.env.RUN_OPENAI_ROUTE_TEST,
};

const REAL_TEST_API_KEY =
  originalEnv.OPENAI_API_KEY_REAL_TEST ?? originalEnv.OPENAI_API_KEY;

const RUN_REAL_OPENAI_ROUTE_TEST =
  process.env.RUN_OPENAI_ROUTE_TEST === "1" && Boolean(REAL_TEST_API_KEY);

const restoreEnvVar = (
  key: keyof typeof originalEnv,
  value: string | undefined
) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

const loadRoute = async (
  options: { mockOpenAi?: boolean; mockNormalizer?: boolean } = {}
) => {
  const { mockOpenAi = true, mockNormalizer = true } = options;

  vi.resetModules();
  vi.doUnmock("@/lib/ai/openai-responses");
  vi.doUnmock("@/lib/ai/model-normalizer");

  if (mockOpenAi) {
    vi.doMock("@/lib/ai/openai-responses", () => ({
      fetchModelCommands: mockFetchModelCommands,
    }));
  }

  if (mockNormalizer) {
    vi.doMock("@/lib/ai/model-normalizer", () => ({
      normalizeModelEnvelope: mockNormalizeModelEnvelope,
    }));
  }

  const route = await import("../route");
  const chatStore = await import("@/lib/ai/chat-store");
  return { POST: route.POST, chatStore };
};

const makeRequest = (body: string | Record<string, unknown>) =>
  new NextRequest("http://localhost/api/ai", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const assertStrictSingleBlackoutCommand = (commands: unknown) => {
  expect(Array.isArray(commands)).toBe(true);
  if (!Array.isArray(commands)) {
    throw new Error("commands is not an array");
  }

  expect(commands).toHaveLength(1);

  const command = commands[0] as {
    type?: unknown;
    payload?: Record<string, unknown>;
  };

  expect(command.type).toBe("add_blackout");
  expect(command.payload).toBeTruthy();
  expect(command.payload?.reason).toBe("Offsite");
  expect(command.payload?.start).toEqual(expect.any(String));
  expect(command.payload?.end).toEqual(expect.any(String));

  expect(String(command.payload?.start)).toMatch(
    /^2026-03-20T00:00:00(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?$/
  );
  expect(String(command.payload?.end)).toMatch(
    /^2026-03-20T23:59:59(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?$/
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchModelCommands.mockReset();
  mockNormalizeModelEnvelope.mockReset();
  restoreEnvVar("OPENAI_API_KEY", originalEnv.OPENAI_API_KEY);
  restoreEnvVar("OPENAI_MODEL", originalEnv.OPENAI_MODEL);
  restoreEnvVar("OPENAI_API_KEY_REAL_TEST", originalEnv.OPENAI_API_KEY_REAL_TEST);
  restoreEnvVar("OPENAI_MODEL_REAL_TEST", originalEnv.OPENAI_MODEL_REAL_TEST);
  restoreEnvVar("RUN_OPENAI_ROUTE_TEST", originalEnv.RUN_OPENAI_ROUTE_TEST);
});

afterAll(() => {
  restoreEnvVar("OPENAI_API_KEY", originalEnv.OPENAI_API_KEY);
  restoreEnvVar("OPENAI_MODEL", originalEnv.OPENAI_MODEL);
  restoreEnvVar("OPENAI_API_KEY_REAL_TEST", originalEnv.OPENAI_API_KEY_REAL_TEST);
  restoreEnvVar("OPENAI_MODEL_REAL_TEST", originalEnv.OPENAI_MODEL_REAL_TEST);
  restoreEnvVar("RUN_OPENAI_ROUTE_TEST", originalEnv.RUN_OPENAI_ROUTE_TEST);
});

describe("POST /api/ai", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const { POST } = await loadRoute();

    const response = await POST(makeRequest('{"message": '));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid request body");
  });

  it("returns 400 when message is missing or empty", async () => {
    const { POST } = await loadRoute();

    const missingResponse = await POST(makeRequest({}));
    expect(missingResponse.status).toBe(400);

    const emptyResponse = await POST(makeRequest({ message: "" }));
    expect(emptyResponse.status).toBe(400);
  });

  it("returns 500 when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    const { POST } = await loadRoute();

    const response = await POST(makeRequest({ message: "hi" }));

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toMatch(/missing openai_api_key/i);
    expect(mockFetchModelCommands).not.toHaveBeenCalled();
  });

  it("returns 200 with chatId, commands, and history on success", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const envelope = { commands: [] };
    const commands = [
      {
        type: "add_blackout",
        payload: {
          start: "2026-03-20T00:00:00Z",
          end: "2026-03-20T23:59:59Z",
          reason: "Offsite",
        },
      },
    ];
    mockFetchModelCommands.mockResolvedValue({ envelope, raw: { id: "raw" } });
    mockNormalizeModelEnvelope.mockReturnValue(commands);
    const { POST } = await loadRoute();

    const response = await POST(makeRequest({ message: "Plan my day" }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.chatId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(data.commands).toEqual(commands);
    expect(data.history).toHaveLength(2);
    expect(data.history[0]).toMatchObject({ role: "user", content: "Plan my day" });
    expect(data.history[1]).toMatchObject({ role: "assistant" });
  });

  it("returns 502 and appends failure message when fetchModelCommands throws", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const chatId = "11111111-1111-4111-8111-111111111111";
    mockFetchModelCommands.mockRejectedValue(new Error("boom"));
    const { POST, chatStore } = await loadRoute();

    const response = await POST(makeRequest({ message: "break it", chatId }));

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toBe("AI parsing failed");
    const history = chatStore.readHistory(chatId);
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("Failed"),
    });
  });

  it("reuses history when chatId is provided", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const chatId = "22222222-2222-4222-8222-222222222222";
    mockFetchModelCommands.mockResolvedValue({ envelope: { commands: [] }, raw: {} });
    mockNormalizeModelEnvelope.mockReturnValue([]);
    const { POST } = await loadRoute();

    const firstResponse = await POST(makeRequest({ message: "first", chatId }));
    const firstBody = await firstResponse.json();

    mockFetchModelCommands.mockResolvedValue({ envelope: { commands: [] }, raw: {} });
    const secondResponse = await POST(makeRequest({ message: "second", chatId }));
    const secondBody = await secondResponse.json();

    expect(secondBody.chatId).toBe(firstBody.chatId);
    expect(secondBody.history.map((m: { content: string }) => m.content)).toEqual([
      "first",
      "Parsed 0 command(s).",
      "second",
      "Parsed 0 command(s).",
    ]);
  });

  it("handles context input and still calls downstream parsing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const envelope = { commands: [] };
    mockFetchModelCommands.mockResolvedValue({ envelope, raw: {} });
    mockNormalizeModelEnvelope.mockReturnValue([]);
    const { POST } = await loadRoute();

    const context = {
      todayLocalDate: "2026-03-12",
      timezone: "Australia/Sydney",
      dailyCapacityHours: 7.5,
      blackouts: [
        {
          id: "blk-1",
          start: "2026-03-14T00:00:00+11:00",
          end: "2026-03-14T23:59:00+11:00",
          reason: "Travel",
        },
      ],
      tasks: [
        {
          id: "t1",
          title: "Existing task",
          status: "active",
          estimateMinutes: 30,
          actualMinutes: 5,
          remainingMinutes: 25,
          priority: 2,
          locked: false,
        },
      ],
    };

    const response = await POST(makeRequest({ message: "with context", context }));

    expect(response.status).toBe(200);
    expect(mockFetchModelCommands).toHaveBeenCalledTimes(1);
    const messages = mockFetchModelCommands.mock.calls[0][0].messages as InputMessage[];
    const contextMessage = messages.find(
      (msg) => msg.role === "system" && msg.content.includes("Known tasks")
    );
    expect(contextMessage?.content).toContain("Planner context:");
    expect(contextMessage?.content).toContain("todayLocalDate: 2026-03-12");
    expect(contextMessage?.content).toContain("timezone: Australia/Sydney");
    expect(contextMessage?.content).toContain("Existing blackouts:");
    expect(contextMessage?.content).toContain("remaining:25min");
  });

  (RUN_REAL_OPENAI_ROUTE_TEST ? it : it.skip)(
    "calls the real OpenAI API and returns exactly one add_blackout command when explicitly enabled",
    async () => {
      process.env.OPENAI_API_KEY = REAL_TEST_API_KEY;
      process.env.OPENAI_MODEL =
        originalEnv.OPENAI_MODEL_REAL_TEST ??
        originalEnv.OPENAI_MODEL ??
        "gpt-4.1-mini";

      const { POST } = await loadRoute({
        mockOpenAi: false,
        mockNormalizer: false,
      });

      const realPrompt = [
        "真实请求：我 2026-03-20 全天都在外地参加 Offsite，无法工作，请帮我在这一天添加 blackout。",
        "约束：只返回一个 add_blackout 命令，reason 必须是 Offsite，startDate 和 endDate 都是 2026-03-20。",
      ].join("\n");

      const context = {
        todayLocalDate: "2026-03-13",
        timezone: "Australia/Sydney",
        dailyCapacityHours: 7.5,
        blackouts: [],
        tasks: [],
      };

      const response = await POST(makeRequest({ message: realPrompt, context }));
      try {
        expect(response.status).toBe(200);
        expect(mockFetchModelCommands).not.toHaveBeenCalled();
        expect(mockNormalizeModelEnvelope).not.toHaveBeenCalled();
      } catch (err) {
        console.log('response body:', await response.clone().text());
        throw err;
      }
      const data = await response.json();
      expect(data.chatId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(data.history).toHaveLength(2);
      expect(data.history[0]).toMatchObject({ role: "user", content: realPrompt });
      expect(data.history[1]).toMatchObject({
        role: "assistant",
        content: "Parsed 1 command(s).",
      });

      expect(Array.isArray(data.raw?.commands)).toBe(true);
      if (!Array.isArray(data.raw?.commands)) {
        throw new Error("raw.commands is not an array");
      }
      expect(data.raw.commands).toHaveLength(1);
      expect(data.raw.commands[0]?.type).toBe("add_blackout");

      expect(data.commands).toHaveLength(1);
      assertStrictSingleBlackoutCommand(data.commands);
    },
    60_000
  );
});
