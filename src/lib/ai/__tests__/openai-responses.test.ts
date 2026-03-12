import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchModelCommands, InputMessage } from "../openai-responses";

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
