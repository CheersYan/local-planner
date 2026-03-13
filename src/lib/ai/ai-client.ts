"use client";

import type { AiCommandBatch, AiReadableContext } from "./command-schema";

export type AiHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
};

export type AiRouteResponse = {
  chatId: string;
  commands: AiCommandBatch;
  history: AiHistoryMessage[];
  raw: unknown;
};

export class AiRouteError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const parseErrorMessage = async (response: Response): Promise<{ message: string; details?: unknown }> => {
  try {
    const data = await response.json();
    const message = typeof data?.error === "string"
      ? data.error
      : data?.message ?? `Request failed with status ${response.status}`;
    return { message, details: data };
  } catch {
    return { message: `Request failed with status ${response.status}` };
  }
};

export async function sendAiMessage(params: {
  message: string;
  chatId?: string;
  context?: AiReadableContext;
  signal?: AbortSignal;
}): Promise<AiRouteResponse> {
  const { message, chatId, context, signal } = params;
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, chatId, context }),
    signal,
  });

  if (!response.ok) {
    const { message: errorMessage, details } = await parseErrorMessage(response);
    throw new AiRouteError(errorMessage, response.status, details);
  }

  return response.json() as Promise<AiRouteResponse>;
}
