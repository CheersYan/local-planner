import type { Metadata } from "next";
import Link from "next/link";
import type { CompletionLog, Task } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { CompletionForm, type CompletionFormTask } from "./completion-form";

export const metadata: Metadata = {
  title: "Completion Log · Local Planner",
  description: "Record task completion with hours and notes, update remaining hours, and replan future days.",
};

export const dynamic = "force-dynamic";

type CompletionListItem = {
  id: string;
  taskTitle: string;
  hoursDone: number;
  loggedDateText: string;
  note?: string;
  remainingHours: number;
};

const computeRemainingHours = (estimateMinutes: number, actualMinutes: number | null): number => {
  const remainingMinutes = Math.max(estimateMinutes - (actualMinutes ?? 0), 0);
  return Math.round((remainingMinutes / 60) * 10) / 10;
};

const formatHours = (hours: number): string => (Number.isInteger(hours) ? hours.toString() : hours.toFixed(1));

const formatDate = (value: Date): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    weekday: "short",
  }).format(value);

const toInputDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const databaseLabel = (() => {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "DATABASE_URL not set";

  if (raw.startsWith("file:")) {
    const filePath = raw.replace(/^file:/, "");
    const fileName = filePath.split(/[/\\]/).pop();
    return fileName ? `SQLite · ${fileName}` : "SQLite file";
  }

  return raw;
})();

const loadTasks = async (): Promise<Task[]> =>
  prisma.task.findMany({
    orderBy: [
      { status: "asc" },
      { priority: "desc" },
      { dueDate: "asc" },
      { createdAt: "asc" },
    ],
  });

const loadCompletionLogs = async (): Promise<Array<CompletionLog & { task: Task }>> =>
  prisma.completionLog.findMany({
    orderBy: [{ loggedAt: "desc" }],
    take: 30,
    include: { task: true },
  });

export default async function CompletionLogPage() {
  const [tasks, completionLogs] = await Promise.all([loadTasks(), loadCompletionLogs()]);

  const taskOptions: CompletionFormTask[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status as CompletionFormTask["status"],
    remainingHours: computeRemainingHours(task.estimateMinutes, task.actualMinutes),
  }));

  const logItems: CompletionListItem[] = completionLogs.map((log) => ({
    id: log.id,
    taskTitle: log.task.title,
    hoursDone: Math.round(((log.minutesSpent ?? 0) / 60) * 10) / 10,
    loggedDateText: formatDate(log.loggedAt),
    note: log.note ?? undefined,
    remainingHours: computeRemainingHours(log.task.estimateMinutes, log.task.actualMinutes),
  }));

  const todayInput = toInputDate(new Date());

  return (
    <main className="min-h-screen bg-background px-6 pb-14 pt-10 text-foreground md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="pill-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">
              Completion log
            </span>
            <span className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Live DB · {databaseLabel}
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Record completed work</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            记录 task、date、hoursDone、note。提交后会写入 completion_log，累计 actualMinutes / remainingHours，并调用规划器重算今天及未来的排期。
          </p>
        </header>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="card-surface p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Log completion</h2>
                <p className="text-sm text-muted-foreground">
                  保存完成记录并立即更新剩余工时与未来计划。
                </p>
              </div>
              <Link
                href="/tasks"
                className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:-translate-y-0.5 hover:shadow"
              >
                View tasks
              </Link>
            </div>

            <div className="mt-8">
              <CompletionForm tasks={taskOptions} defaultDate={todayInput} />
            </div>
          </div>

          <div className="card-surface p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">Recent completion log</h3>
                <p className="text-sm text-muted-foreground">最新 30 条记录（按日期倒序）。</p>
              </div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">read-only</span>
            </div>

            <div className="mt-4 space-y-3">
              {logItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
                  还没有完成记录。填写左侧表单以添加一条完成记录并触发重排。
                </div>
              ) : (
                logItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl bg-surface/70 px-4 py-3 ring-1 ring-border/70"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-sm font-semibold leading-snug">{item.taskTitle}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.loggedDateText} · {formatHours(item.hoursDone)}h
                        </div>
                      </div>
                      <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Remaining {formatHours(item.remainingHours)}h
                      </span>
                    </div>
                    {item.note ? (
                      <p className="mt-2 text-sm text-foreground/90">{item.note}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
