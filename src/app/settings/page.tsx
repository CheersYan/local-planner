import type { Metadata } from "next";
import Link from "next/link";

import { prisma } from "@/lib/prisma";

import {
  materializeSettings,
  SETTING_KEYS,
  type PlannerSettings,
} from "./config";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Settings · Local Planner",
  description: "Configure planning capacity, window, and weekend rules.",
};

export const dynamic = "force-dynamic";

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

const loadSettings = async (): Promise<PlannerSettings> => {
  const records = await prisma.setting.findMany({
    where: { key: { in: SETTING_KEYS } },
    select: { key: true, value: true },
  });

  return materializeSettings(records);
};

export default async function SettingsPage() {
  const settings = await loadSettings();

  return (
    <main className="min-h-screen bg-background px-6 pb-14 pt-10 text-foreground md:px-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="pill-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">
              Settings
            </span>
            <span className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Live DB · {databaseLabel}
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Planner defaults</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            配置每日容量、滚动规划窗口与周末可用性。所有设置直接写入 SQLite <code className="rounded bg-muted px-1 py-0.5 text-[11px]">settings</code> 表，供排期逻辑读取。
          </p>
        </header>

        <div className="card-surface p-8 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Deterministic inputs
              </p>
              <h2 className="text-xl font-semibold leading-snug">Planning parameters</h2>
              <p className="text-sm text-muted-foreground">
                修改后立即生效；历史日志不被修改，重新排期仅影响今天与未来。
              </p>
            </div>
            <Link
              href="/"
              className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:-translate-y-0.5 hover:shadow"
            >
              Back home
            </Link>
          </div>

          <div className="mt-8">
            <SettingsForm initialValues={settings} />
          </div>
        </div>
      </div>
    </main>
  );
}
