import { AiChatPanel } from "@/components/ai/ai-chat-panel";

type PlanTaskStatus = "active" | "completed" | "paused";

type PlanTask = {
  id: string;
  title: string;
  status: PlanTaskStatus;
  minutes: number;
  note?: string;
};

type PlanDay = {
  id: string;
  label: string;
  dateText: string;
  focus: string;
  capacityMinutes: number;
  loadMinutes: number;
  tasks: PlanTask[];
};

type SnapshotItem = {
  id: string;
  label: string;
  value: string;
  helper: string;
};

type AlertItem = {
  id: string;
  label: string;
  detail: string;
  tone: "info" | "warn";
};

type LogEntry = {
  id: string;
  label: string;
  detail: string;
  when: string;
};

const planDays: PlanDay[] = [
  {
    id: "today",
    label: "Today",
    dateText: "Tue · Mar 10",
    focus: "稳定迭代交付，留出设计探讨论证",
    capacityMinutes: 420,
    loadMinutes: 360,
    tasks: [
      { id: "t1", title: "迭代交付：核心验收用例", status: "active", minutes: 180 },
      { id: "t2", title: "设计探讨论证（UI+交互）", status: "active", minutes: 120, note: "14:00 起" },
      { id: "t3", title: "补充测试用例与截图", status: "active", minutes: 60 },
    ],
  },
  {
    id: "w1",
    label: "Wed",
    dateText: "Mar 11",
    focus: "把剩余交付切片，预留回顾",
    capacityMinutes: 420,
    loadMinutes: 300,
    tasks: [
      { id: "t4", title: "迭代交付：文案 & 边缘态", status: "active", minutes: 150 },
      { id: "t5", title: "回顾前准备：数据截图", status: "active", minutes: 90 },
      { id: "t6", title: "Inbox 清理与排期校验", status: "active", minutes: 60 },
    ],
  },
  {
    id: "w2",
    label: "Thu",
    dateText: "Mar 12",
    focus: "上午 blackout，下午补齐测试",
    capacityMinutes: 240,
    loadMinutes: 210,
    tasks: [
      { id: "t7", title: "黑名单窗口", status: "completed", minutes: 180, note: "09:00–12:00 不可用" },
      { id: "t8", title: "验收回放 + 录屏", status: "active", minutes: 90 },
    ],
  },
  {
    id: "w3",
    label: "Fri",
    dateText: "Mar 13",
    focus: "缓冲 + 提交物料",
    capacityMinutes: 420,
    loadMinutes: 240,
    tasks: [
      { id: "t9", title: "完善迭代交付包", status: "active", minutes: 150 },
      { id: "t10", title: "周回顾 & 议题整理", status: "active", minutes: 90 },
    ],
  },
];

const snapshot: SnapshotItem[] = [
  {
    id: "s1",
    label: "Capacity",
    value: "21h planned / 26h available",
    helper: "今日+未来 7 天剩余 5h 缓冲",
  },
  {
    id: "s2",
    label: "Tasks",
    value: "8 planned · 1 in progress",
    helper: "未锁定任务 6 个，可重排",
  },
  {
    id: "s3",
    label: "Reminders",
    value: "1 blackout · 0 overdue",
    helper: "只影响 3/12 上午",
  },
];

const alerts: AlertItem[] = [
  {
    id: "al1",
    label: "容量提示",
    detail: "周四因 blackout 可用时间仅 4h，已自动顺延到周五。",
    tone: "warn",
  },
  {
    id: "al2",
    label: "重排范围",
    detail: "仅调整今天及未来 7 天，历史日志保持不变。",
    tone: "info",
  },
];

const recentLogs: LogEntry[] = [
  {
    id: "lg1",
    label: "完成",
    detail: "周报初稿 · 35 分钟",
    when: "昨天 18:05",
  },
  {
    id: "lg2",
    label: "估时调整",
    detail: "迭代交付 from 8h → 10h",
    when: "昨天 12:24",
  },
  {
    id: "lg3",
    label: "新增",
    detail: "设计探讨论证 · 2h",
    when: "昨天 10:02",
  },
];

const planProgress = (loadMinutes: number, capacityMinutes: number): number => {
  if (capacityMinutes <= 0) return 0;

  const raw = Math.round((loadMinutes / capacityMinutes) * 100);
  return Math.max(0, Math.min(120, raw));
};

const statusBadge = (status: PlanTaskStatus): string => {
  if (status === "completed") return "bg-success/15 text-success";
  if (status === "active") return "bg-primary/15 text-primary";
  return "bg-muted text-muted-foreground";
};

export default function Home() {
  return (
    <main className="min-h-screen bg-background px-6 pb-14 pt-10 text-foreground md:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <span className="pill-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            Home · preview
          </span>
          <h1 className="text-4xl font-semibold tracking-tight">Planner overview</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            左侧聊天面板已接通本地 /api/ai 并仅做命令预览；中右栏仍为静态示例排程，未写数据库。
          </p>
        </header>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.45fr_1fr]">
          <AiChatPanel />

          <div className="flex h-full flex-col gap-4">
            {planDays.slice(0, 1).map((day) => (
              <div key={day.id} className="card-surface p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">{day.label} · {day.dateText}</h2>
                    <p className="text-sm text-muted-foreground">{day.focus}</p>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <div>
                      {Math.round(day.loadMinutes / 60)}h / {Math.round(day.capacityMinutes / 60)}h
                    </div>
                    <div className="text-xs">今日只展示静态排程</div>
                  </div>
                </div>

                <div className="mt-4">
                  <ProgressBar
                    label="Capacity"
                    percent={planProgress(day.loadMinutes, day.capacityMinutes)}
                  />
                </div>

                <div className="mt-4 space-y-3">
                  {day.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-start justify-between gap-3 rounded-2xl bg-surface/60 px-4 py-3 ring-1 ring-border/70"
                    >
                      <div className="space-y-0.5">
                        <div className="text-sm font-semibold leading-snug">{task.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {task.minutes} min{task.note ? ` · ${task.note}` : ""}
                        </div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadge(task.status)}`}>
                        {task.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="card-surface p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight">未来 7 天</h3>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">静态示例</span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {planDays.map((day) => (
                  <div
                    key={day.id}
                    className="rounded-2xl bg-surface/70 p-4 shadow-sm ring-1 ring-border/70"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold leading-snug">{day.label}</div>
                        <div className="text-xs text-muted-foreground">{day.dateText}</div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>{Math.round(day.loadMinutes / 60)}h / {Math.round(day.capacityMinutes / 60)}h</div>
                        <div className="mt-1 h-2 w-20 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${planProgress(day.loadMinutes, day.capacityMinutes)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {day.tasks.slice(0, 2).map((task) => (
                        <li key={task.id} className="flex items-center gap-2 truncate">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                          <span className="truncate">{task.title}</span>
                        </li>
                      ))}
                      {day.tasks.length > 2 ? (
                        <li className="text-[11px] text-muted-foreground">… {day.tasks.length - 2} more</li>
                      ) : null}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col gap-4">
            <div className="card-surface p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight">Summary</h3>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">静态快照</span>
              </div>
              <div className="mt-4 space-y-3">
                {snapshot.map((item) => (
                  <div key={item.id} className="rounded-2xl bg-surface/70 p-3 ring-1 ring-border/60">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</div>
                    <div className="text-sm font-semibold leading-snug">{item.value}</div>
                    <div className="text-xs text-muted-foreground">{item.helper}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-surface p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight">Alerts</h3>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">no api calls</span>
              </div>
              <div className="mt-3 space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`rounded-2xl px-4 py-3 text-sm ring-1 ring-border/70 ${
                      alert.tone === "warn" ? "bg-accent/15 text-accent-foreground" : "bg-muted/50 text-foreground"
                    }`}
                  >
                    <div className="font-semibold leading-snug">{alert.label}</div>
                    <div className="text-xs text-muted-foreground">{alert.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-surface p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight">Recent log</h3>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">只读</span>
              </div>
              <div className="mt-3 space-y-2.5">
                {recentLogs.map((log) => (
                  <div key={log.id} className="flex items-start justify-between gap-3 rounded-2xl bg-surface/60 px-4 py-2.5 text-sm ring-1 ring-border/70">
                    <div className="space-y-0.5">
                      <div className="font-semibold leading-snug">{log.label}</div>
                      <div className="text-xs text-muted-foreground">{log.detail}</div>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{log.when}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(120, percent));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <span>{clamped}%</span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-muted">
        <div
          className={`absolute left-0 top-0 h-full rounded-full ${clamped > 100 ? "bg-danger" : "bg-primary"}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
