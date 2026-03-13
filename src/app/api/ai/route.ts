import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { appendHistory, ChatMessage, createChatId, readHistory } from "@/lib/ai/chat-store";
import {
  AiCommandBatch,
  aiReadableContextSchema,
  type AiReadableBlackout,
  type AiReadableContext,
  type AiReadableTask,
} from "@/lib/ai/command-schema";
import { fetchModelCommands, InputMessage } from "@/lib/ai/openai-responses";
import { normalizeModelEnvelope } from "@/lib/ai/model-normalizer";

const requestSchema = z.object({
  message: z.string().min(1, "message is required"),
  chatId: z.string().uuid().optional(),
  context: aiReadableContextSchema.optional(),
});

export const systemPrompt = `You convert user intent into planner commands only.
- Allowed commands: create_tasks, log_completion, shrink_task, add_blackout, add_urgent_task.
- Do not change past days; only describe actions as structured commands.
- Use the provided JSON schema; never add fields or prose outside the JSON.
- If the request is unclear or does not map cleanly to the allowed commands, return {"commands": []} instead of guessing.
- A clear request like "I cannot work on 2026-03-20 because I am offsite" must be converted into an add_blackout for that date.
- When the user supplies enough fields and clearly targets an allowed command, respond with that command instead of {"commands": []}.
- Keep notes concise (max 500 chars) and reasons under 300 chars.
- Date-only fields (add_blackout.startDate, add_blackout.endDate, all dueDate fields) must be exactly YYYY-MM-DD — no time, timezone, natural language, or ranges.
- Example add_blackout: {"commands":[{"type":"add_blackout","payload":{"startDate":"2026-03-20","endDate":"2026-03-21","reason":"Offsite"}}]}
- Never output time or timezone inside date-only fields; only loggedAt is a datetime.`;

const computeRemainingMinutes = (task: AiReadableTask): number => {
  if (typeof task.remainingMinutes === "number" && Number.isFinite(task.remainingMinutes)) {
    return Math.max(0, Math.round(task.remainingMinutes));
  }

  const actual = typeof task.actualMinutes === "number" && Number.isFinite(task.actualMinutes) ? task.actualMinutes : 0;
  return Math.max(0, Math.round(task.estimateMinutes - actual));
};

const formatPlannerMeta = (context: AiReadableContext): string | null => {
  const parts: string[] = [];

  if (context.todayLocalDate) {
    parts.push(`todayLocalDate: ${context.todayLocalDate}`);
  }

  if (context.timezone) {
    parts.push(`timezone: ${context.timezone}`);
  }

  if (context.dailyCapacityHours !== undefined) {
    const hours = Math.round(context.dailyCapacityHours * 100) / 100;
    parts.push(`dailyCapacityHours: ${hours}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return `Planner context: ${parts.join(" | ")}`;
};

const formatBlackouts = (blackouts?: AiReadableBlackout[]): string | null => {
  if (!blackouts || blackouts.length === 0) return null;

  const lines = [...blackouts].map(
    (window) => `• ${window.start} → ${window.end} (${window.reason})`
  );

  return `Existing blackouts:\n${lines.join("\n")}`;
};

const formatTaskLine = (task: AiReadableTask): string => {
  const remainingMinutes = computeRemainingMinutes(task);
  const segments = [
    `• ${task.title} (#${task.id})`,
    `status:${task.status}`,
    `est:${task.estimateMinutes}min`,
    `remaining:${remainingMinutes}min`,
  ];

  if (task.dueDate) {
    segments.push(`due:${task.dueDate}`);
  }

  if (task.plannedDate) {
    segments.push(`planned:${task.plannedDate}`);
  }

  segments.push(`priority:${task.priority}`);

  if (task.locked) {
    segments.push("locked");
  }

  return segments.join(" ");
};

const renderContext = (context?: AiReadableContext): string | null => {
  if (!context) return null;

  const sections: string[] = [];
  const meta = formatPlannerMeta(context);
  if (meta) {
    sections.push(meta);
  }

  const blackoutSection = formatBlackouts(context.blackouts);
  if (blackoutSection) {
    sections.push(blackoutSection);
  }

  if (context.tasks.length > 0) {
    const lines = context.tasks.map(formatTaskLine);
    sections.push(`Known tasks:\n${lines.join("\n")}`);
  }

  if (sections.length === 0) {
    return null;
  }

  return sections.join("\n\n");
};

const toInputMessages = (history: ChatMessage[], context?: AiReadableContext): InputMessage[] => {
  const messages: InputMessage[] = [{ role: "system", content: systemPrompt }];
  const renderedContext = renderContext(context);
  if (renderedContext) {
    messages.push({ role: "system", content: renderedContext });
  }

  const sortedHistory = [...history].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp)
  );
  sortedHistory.forEach((message) =>
    messages.push({ role: message.role, content: message.content })
  );
  return messages;
};

const nowIso = (): string => new Date().toISOString();

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { message, chatId: incomingChatId, context } = parsed.data;
  const chatId = incomingChatId ?? createChatId();

  appendHistory(chatId, [{ role: "user", content: message, timestamp: nowIso() }]);
  const history = readHistory(chatId);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY on server" },
      { status: 500 }
    );
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const inputMessages = toInputMessages(history, context);

  try {
    const { envelope } = await fetchModelCommands({
      apiKey,
      model,
      messages: inputMessages,
    });

    const commands: AiCommandBatch = normalizeModelEnvelope(envelope);

    appendHistory(chatId, [
      {
        role: "assistant",
        content: `Parsed ${commands.length} command(s).`,
        timestamp: nowIso(),
      },
    ]);

    return NextResponse.json({
      chatId,
      commands,
      raw: envelope,
      history: readHistory(chatId),
    });
  } catch (error) {
    console.error("AI parsing failed", error);
    appendHistory(chatId, [
      {
        role: "assistant",
        content: "Failed to parse the last message.",
        timestamp: nowIso(),
      },
    ]);

    return NextResponse.json(
      { error: "AI parsing failed", details: String(error) },
      { status: 502 }
    );
  }
}
