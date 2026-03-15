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
import {
  fetchModelCommands,
  InputMessage,
  type OpenAITrace,
} from "@/lib/ai/openai-responses";
import { normalizeModelEnvelope } from "@/lib/ai/model-normalizer";

const requestSchema = z.object({
  message: z.string().min(1, "message is required"),
  chatId: z.string().uuid().optional(),
  context: aiReadableContextSchema.optional(),
});

export const systemPrompt = `You convert user intent into planner commands only (preview, no execution).
- Allowed commands: create_tasks, log_completion, shrink_task, add_blackout, update_blackout_window, delete_blackout_window, add_urgent_task, update_task_fields, reschedule_task, reprioritize_task, pause_task, resume_task, delete_task, restore_task, split_task, merge_tasks, mark_task_done, reopen_task.
- For task edits, always include target {taskId | title | fuzzyTitle}.
  - If the user explicitly provides taskId, include taskId.
  - Otherwise prefer title or fuzzyTitle and keep the user's phrasing.
  - Do not return {"commands": []} just because taskId is missing.
  - Do not guess the final database match; leave ambiguity to the backend matcher.
- For blackout edits, include target {blackoutId | startDate + endDate | fuzzyReason}. startDate/endDate use YYYY-MM-DD only. Do not guess blackoutId.
- Use hours (not minutes) for estimateHours / remainingHours fields in update_task_fields, split_task.parts, merge_tasks, and reopen_task. Round to one decimal if needed.
- Priorities: low | medium | high | urgent. Dates: YYYY-MM-DD only (no time). Notes <= 500 chars, reasons <= 300 chars.
- reschedule_task updates dueDate (null clears). reprioritize_task only changes priority.
- pause_task/resume_task toggle active vs paused. delete_task is soft delete; restore_task undoes it.
- mark_task_done sets status completed & remainingHours = 0. reopen_task requires remainingHours > 0; if the user didn't provide it, return {"commands": []} and explain the missing field.
- split_task must have >=2 parts with titles; include estimateHours or remainingHours for each part; inherit dueDate/priority when absent. merge_tasks must list >=2 targets and a merged title; include remainingHours if stated.
- Do not guess taskIds or choose between duplicate titles. If unclear or out of scope, return {"commands": []}.
JSON examples:
{"commands":[{"type":"update_task_fields","payload":{"target":{"taskId":"t1"},"title":"产品 demo","estimateHours":3,"remainingHours":2,"dueDate":"2026-03-28","priority":"high","note":null}}]}
{"commands":[{"type":"reschedule_task","payload":{"target":{"taskId":"t2"},"dueDate":"2026-03-28","reason":null}}]}
{"commands":[{"type":"reprioritize_task","payload":{"target":{"title":"周报"},"priority":"urgent","reason":null}}]}
{"commands":[{"type":"pause_task","payload":{"target":{"taskId":"t3"},"reason":"等待依赖"}}]}
{"commands":[{"type":"resume_task","payload":{"target":{"title":"测试任务"},"reason":null}}]}
{"commands":[{"type":"delete_task","payload":{"target":{"title":"旧版汇报任务"},"reason":null}}]}
{"commands":[{"type":"restore_task","payload":{"target":{"fuzzyTitle":"汇报"}}}]}
{"commands":[{"type":"split_task","payload":{"target":{"taskId":"t4"},"parts":[{"title":"准备材料","estimateHours":2,"remainingHours":null,"dueDate":null,"priority":null,"note":null},{"title":"排练","estimateHours":3,"remainingHours":null,"dueDate":null,"priority":null,"note":null}]}}]}
{"commands":[{"type":"merge_tasks","payload":{"targets":[{"title":"任务A"},{"title":"任务B"}],"title":"方案整合","remainingHours":5,"priority":"high","dueDate":null,"note":null}}]}
{"commands":[{"type":"mark_task_done","payload":{"target":{"title":"文档整理"},"note":null}}]}
{"commands":[{"type":"reopen_task","payload":{"target":{"title":"文档整理"},"remainingHours":2,"note":null}}]}
{"commands":[{"type":"add_blackout","payload":{"startDate":"2026-03-20","endDate":"2026-03-21","reason":"Offsite"}}]}
{"commands":[{"type":"update_blackout_window","payload":{"target":{"startDate":"2026-03-18","endDate":"2026-03-20"},"startDate":"2026-03-19","endDate":"2026-03-21","reason":null}}]}
{"commands":[{"type":"delete_blackout_window","payload":{"target":{"fuzzyReason":"出差"}}}]}`;

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
    `• title: ${task.title}`,
    `id:${task.id}`,
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

  return segments.join(" | ");
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

const toTracePayload = (trace: OpenAITrace) => ({
  clientRequestId: trace.clientRequestId,
  openaiResponseId: trace.openaiResponseId,
  xRequestId: trace.xRequestId,
  model: trace.model,
  usage: trace.usage,
});

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
    const { envelope, trace } = await fetchModelCommands({
      apiKey,
      model,
      messages: inputMessages,
      chatId,
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
      trace: toTracePayload(trace),
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
