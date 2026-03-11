import type { Metadata } from "next";
import Link from "next/link";

import { TaskForm } from "./task-form";

export const metadata: Metadata = {
  title: "Add Task · Local Planner",
  description: "Manually add a task with estimate, due date, and priority.",
};

export default function NewTaskPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-14">
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary transition hover:-translate-y-0.5 hover:text-primary"
        >
          <span aria-hidden="true">←</span>
          Back to overview
        </Link>
      </div>

      <section className="card-surface border border-border/70 p-8 shadow-xl md:p-10">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Manual entry
          </p>
          <h1 className="text-3xl font-semibold leading-tight text-foreground">
            Add a task by hand
          </h1>
          <p className="text-base text-muted-foreground">
            填写标题、预估工时（小时）、截止日期和优先级。提交后将直接写入本地 SQLite
            数据库（通过 Prisma），不经过 AI。
          </p>
        </div>

        <div className="mt-10">
          <TaskForm />
        </div>
      </section>
    </main>
  );
}
