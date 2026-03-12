import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { modelCommandEnvelopeSchema, ModelAiCommandEnvelope } from "./model-command-schema";

export type InputMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ParsedModelCommands = {
  envelope: ModelAiCommandEnvelope;
  raw: unknown;
};

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
      format: zodTextFormat(modelCommandEnvelopeSchema, "planner_commands"),
    },
  });

  const envelope = modelCommandEnvelopeSchema.parse(response.output_parsed);
  return { envelope, raw: response };
};
