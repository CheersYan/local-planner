"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";

import type { AiCommandBatch } from "@/lib/ai/command-schema";
import { sendAiMessage, type AiRouteError } from "@/lib/ai/ai-client";
import type { CommandResult } from "@/lib/commands/types";
import { CommandPreviewList } from "./command-preview-list";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type AiChatPanelProps = {
  initialCommands?: AiCommandBatch;
  initialMessages?: ChatMessage[];
  initialHasResult?: boolean;
  initialError?: string | null;
};

type QuickPrompt = {
  id: string;
  label: string;
  hint: string;
  text: string;
};

const quickPrompts: QuickPrompt[] = [
  {
    id: "qp-create",
    label: "新增任务",
    hint: "create_tasks",
    text: "帮我新增任务：完善周报，预估 90 分钟，due 2026-03-20，优先级 high。",
  },
  {
    id: "qp-log",
    label: "记录完成",
    hint: "log_completion",
    text: "记录一下：任务“整理会议纪要”刚完成，花了 45 分钟，标记完成并记一条备注：已同步到项目文档。",
  },
  {
    id: "qp-shrink",
    label: "缩短工时",
    hint: "shrink_task",
    text: "把任务 t1 剩余时间调整为 60 分钟，之前估时 120，原因是需求缩减。",
  },
  {
    id: "qp-blackout",
    label: "设置 blackout",
    hint: "add_blackout",
    text: "我 2026-03-20 全天都在外地，无法工作，请添加 blackout。",
  },
  {
    id: "qp-urgent",
    label: "紧急任务",
    hint: "add_urgent_task",
    text: "新增紧急任务：修复支付回退 bug，预估 120 分钟，截止 2026-03-18，原因是上线 blocker。",
  },
  {
    id: "qp-edit",
    label: "修改任务",
    hint: "update_task_fields",
    text: "把 demo 任务改名成产品 demo，并将剩余工时设为 3 小时，截止 2026-03-28，优先级 urgent。",
  },
  {
    id: "qp-pause",
    label: "暂停任务",
    hint: "pause_task",
    text: "把“测试任务”暂停一下，原因等待依赖。",
  },
];

const makeId = (): string =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2));

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export function AiChatPanel({
  initialCommands = [],
  initialMessages = [],
  initialHasResult,
  initialError = null,
}: AiChatPanelProps) {
  const router = useRouter();
  const resolvedHasResult = initialHasResult ?? (initialCommands.length > 0 || Boolean(initialError));

  const [input, setInput] = useState("");
  const [chatId, setChatId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [commands, setCommands] = useState<AiCommandBatch>(initialCommands);
  const [isSending, setIsSending] = useState(false);
  const [hasResult, setHasResult] = useState(resolvedHasResult);
  const [error, setError] = useState<string | null>(initialError);
  const [previewResults, setPreviewResults] = useState<CommandResult[] | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, commands]);

  const assistantSummary = useMemo(() => {
    if (commands.length === 0 && hasResult) return "未识别到可执行操作";
    if (commands.length === 0) return "等待解析结果";
    return `识别到 ${commands.length} 个操作`;
  }, [commands.length, hasResult]);

  const runPreview = async (batch: AiCommandBatch) => {
    if (batch.length === 0) {
      setPreviewResults(null);
       setStatusTone(null);
      return;
    }

    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preview", commands: batch }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "预览失败");
      }
      setPreviewResults(data.results ?? null);
      setStatusMessage(null);
      setStatusTone(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "预览失败";
      setStatusMessage(message);
      setStatusTone("error");
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsSending(true);
    setError(null);

    try {
      const response = await sendAiMessage({ message: trimmed, chatId });
      setChatId(response.chatId);
      setCommands(response.commands);
      void runPreview(response.commands);
      setHasResult(true);

      const assistantMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: response.commands.length > 0 ? `识别到 ${response.commands.length} 个操作` : "未识别到可执行操作",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setInput("");
    } catch (err) {
      setHasResult(true);
      const routeError = err as AiRouteError;
      const friendly = routeError?.message ?? "解析失败，请稍后再试。";
      setError(friendly);
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleQuickPrompt = (text: string) => {
    setInput(text);
  };

  const handleExecute = async () => {
    if (commands.length === 0 || isExecuting) return;
    setIsExecuting(true);
    setStatusMessage(null);
    setStatusTone(null);

    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "execute", commands }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "执行失败");
      }

      setPreviewResults(data.results ?? null);
      const successMessage = data.replanTriggered ? "执行成功，已触发重排" : "执行成功";
      setStatusMessage(successMessage);
      setStatusTone("success");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "执行失败，请稍后重试。";
      setStatusMessage(message);
      setStatusTone("error");
    } finally {
      setIsExecuting(false);
    }
  };

  useEffect(() => {
    if (commands.length > 0 && !isSending) {
      void runPreview(commands);
    }
  }, [commands, isSending]);

  const emptyState = (
    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      还没有消息。输入一句话或点击下方提示，系统会调用本地 /api/ai 路由解析为可预览的命令，不会直接执行。
    </div>
  );

  return (
    <div className="card-surface flex h-full flex-col gap-4 p-6" data-testid="ai-chat-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Chat & commands</h2>
          <p className="text-sm text-muted-foreground">
            发送自然语言，先经 /api/ai 解析，再在本地预览 / 执行命令（事务 + 重排，数据库为真）。
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          preview + execute
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>消息</span>
          <span>{assistantSummary}</span>
        </div>
        <div className="max-h-[320px] min-h-[200px] space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            emptyState
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 shadow-sm ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface text-foreground ring-1 ring-border/70"
                  }`}
                >
                  <div className="text-sm leading-relaxed">{message.content}</div>
                  <div className="mt-1 text-[11px] font-medium opacity-75">
                    {formatTime(message.timestamp)}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={listRef} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Quick prompts</span>
          <span>Enter 发送 · Shift+Enter 换行</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              onClick={() => handleQuickPrompt(prompt.text)}
              className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:-translate-y-0.5 hover:shadow"
              disabled={isSending}
            >
              {prompt.label}
              <span className="ml-2 text-[11px] font-normal lowercase opacity-80">{prompt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-2xl border border-border/70 bg-surface/80 px-4 py-3 shadow-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/30">
          <textarea
            className="w-full resize-none border-none bg-transparent text-sm text-foreground outline-none"
            rows={3}
            placeholder="用一句话描述你想要的操作。"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            aria-label="Chat input"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{isSending ? "正在解析 /api/ai…" : "本地状态，不会执行命令"}</span>
            <button
              type="submit"
              disabled={isSending || input.trim().length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSending ? "解析中…" : "发送"}
            </button>
          </div>
        </div>
        {error ? (
          <div
            className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
            role="alert"
          >
            请求失败：{error}
          </div>
        ) : null}
      </form>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => void handleExecute()}
          disabled={commands.length === 0 || isExecuting}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isExecuting ? "执行中…" : "执行这些命令"}
        </button>
        {statusMessage ? (
          <span
            className={`text-xs ${
              statusTone === "success"
                ? "text-success"
                : statusTone === "error"
                  ? "text-danger"
                  : "text-muted-foreground"
            }`}
          >
            {statusMessage}
          </span>
        ) : null}
      </div>

      <CommandPreviewList
        commands={commands}
        results={previewResults}
        isLoading={isSending}
        hasResult={hasResult}
        statusMessage={statusMessage}
        statusTone={statusTone}
      />
    </div>
  );
}
