import type { Metadata } from "next";
import Link from "next/link";

import type { Task } from "@prisma/client";

import { prisma, type TaskStatus } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Tasks · Local Planner",
  description: "Task list and detail cards with remaining hours, due dates, priority, and status.",
};

// Force dynamic rendering so the page always reflects the current SQLite database.
export const dynamic = "force-dynamic";

type PlannerTask = Pick<
  Task,
  "id" | "title" | "estimateMinutes" | "actualMinutes" | "dueDate" | "priority" | "plannedDate" | "createdAt"
> & {
  status: TaskStatus;
};

type TaskWithDerived = PlannerTask & {
  remainingHours: number;
};

type TasksPageProps = {
  searchParams: Promise<{
    taskId?: string | string[];
  }>;
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

const statusTone: Record<TaskStatus, string> = {
  planned: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/15 text-primary",
  done: "bg-success/15 text-success",
  dropped: "bg-danger/15 text-danger",
};

const statusLabel: Record<TaskStatus, string> = {
  planned: "planned",
  in_progress: "in progress",
  done: "done",
  dropped: "dropped",
};

const computeRemainingHours = (estimateMinutes: number, actualMinutes: number | null): number => {
  const remainingMinutes = Math.max(estimateMinutes - (actualMinutes ?? 0), 0);
  return Math.round((remainingMinutes / 60) * 10) / 10;
};

const formatHours = (hours: number): string => (Number.isInteger(hours) ? hours.toString() : hours.toFixed(1));

const formatDate = (value: Date | null): string => {
  if (!value) return "No due date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    weekday: "short",
  }).format(value);
};

const parseTaskId = (raw: string | string[] | undefined): string | undefined => {
  if (Array.isArray(raw)) return raw[0];
  return raw;
};

const toDerivedTask = (task: PlannerTask): TaskWithDerived => ({
  ...task,
  remainingHours: computeRemainingHours(task.estimateMinutes, task.actualMinutes),
});

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = await searchParams;

  const rawTasks = await prisma.task.findMany({
    orderBy: [
      { priority: "desc" },
      { dueDate: "asc" },
      { createdAt: "asc" },
    ],
  });

  const tasks: TaskWithDerived[] = rawTasks.map((task) =>
    toDerivedTask({
      id: task.id,
      title: task.title,
      status: task.status as TaskStatus,
      estimateMinutes: task.estimateMinutes,
      actualMinutes: task.actualMinutes,
      dueDate: task.dueDate,
      priority: task.priority,
      plannedDate: task.plannedDate,
      createdAt: task.createdAt,
    }),
  );

  const selectedId = parseTaskId(resolvedSearchParams?.taskId);
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? tasks[0];

  return (
    <main className="min-h-screen bg-background px-6 pb-14 pt-10 text-foreground md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="pill-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">Tasks</span>
            <span className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Live DB · {databaseLabel}
            </span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Task list & detail</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            展示任务的 remainingHours、dueDate、priority、status。数据直接读取本地 SQLite，不包含重排逻辑。
          </p>
        </header>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="card-surface p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Task list</h2>
                <p className="text-sm text-muted-foreground">选择任意任务查看详情。</p>
              </div>
              <Link
                href="/tasks/new"
                className="rounded-full bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                Add task
              </Link>
            </div>

            <div className="mt-4 space-y-2.5">
              {tasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
                  当前数据库暂无任务（{databaseLabel}）。点击右上角添加一个，或运行
                  <code className="mx-1 rounded bg-surface px-2 py-1 text-[11px]">DATABASE_URL=&quot;file:./prisma/dev.db&quot; pnpm seed</code>
                  载入示例数据。
                </div>
              ) : (
                tasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/tasks?taskId=${task.id}`}
                    className={`flex items-start justify-between gap-3 rounded-2xl bg-surface/70 px-4 py-3 ring-1 ring-border/70 transition hover:-translate-y-0.5 hover:ring-primary/60 ${
                      selectedTask?.id === task.id ? "ring-2 ring-primary" : ""
                    }`}
                    prefetch={false}
                  >
                    <div className="space-y-1">
                      <div className="text-sm font-semibold leading-snug">{task.title}</div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-primary/70" aria-hidden />
                          Remaining {formatHours(task.remainingHours)}h
                        </span>
                        <span>Due {formatDate(task.dueDate)}</span>
                        <span>Priority {task.priority}</span>
                      </div>
                    </div>
                    <StatusBadge status={task.status} />
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="card-surface p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Task detail
                </p>
                <h2 className="text-xl font-semibold leading-snug text-foreground">
                  {selectedTask ? selectedTask.title : "No task selected"}
                </h2>
              </div>
              {selectedTask ? <StatusBadge status={selectedTask.status} /> : null}
            </div>

            {selectedTask ? (
              <div className="mt-5 space-y-3">
                <DetailRow label="Remaining" value={`${formatHours(selectedTask.remainingHours)} h`} />
                <DetailRow label="Due date" value={formatDate(selectedTask.dueDate)} />
                <DetailRow label="Priority" value={selectedTask.priority.toString()} />
                <DetailRow label="Status" value={statusLabel[selectedTask.status]} />
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
                还没有任务可展示。
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusTone[status]}`}
    >
      {statusLabel[status]}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface/70 px-4 py-3 ring-1 ring-border/70">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
