import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { InputMessage } from "@/lib/ai/openai-responses";

const mockFetchModelCommands = vi.fn();
const mockNormalizeModelEnvelope = vi.fn();
const originalEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
};

vi.mock("@/lib/ai/openai-responses", () => ({
  fetchModelCommands: mockFetchModelCommands,
}));

vi.mock("@/lib/ai/model-normalizer", () => ({
  normalizeModelEnvelope: mockNormalizeModelEnvelope,
}));

const loadRoute = async () => {
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

beforeEach(() => {
  vi.resetModules(); // clears chat-store in-memory map between tests
  vi.clearAllMocks();
  mockFetchModelCommands.mockReset();
  mockNormalizeModelEnvelope.mockReset();
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL;
});

afterAll(() => {
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL;
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
        payload: { start: "2026-03-20T00:00:00Z", end: "2026-03-20T23:59:59Z", reason: "Offsite" },
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
        { id: "blk-1", start: "2026-03-14T00:00:00+11:00", end: "2026-03-14T23:59:00+11:00", reason: "Travel" },
      ],
      tasks: [
        {
          id: "t1",
          title: "Existing task",
          status: "planned",
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
});
