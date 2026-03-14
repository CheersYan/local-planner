import type { AiCommand } from "@/lib/ai/command-schema";

export type TaskPreview = {
  id: string;
  title: string;
  status: "active" | "paused" | "completed" | "archived";
  estimateMinutes: number;
  remainingMinutes?: number | null;
  actualMinutes?: number | null;
  dueDate?: string | null;
  priority: number;
  note?: string | null;
  deletedAt?: string | null;
  parentTaskId?: string | null;
};

export type TaskChange = {
  before: TaskPreview;
  after: TaskPreview;
};

export type BlackoutPreview = {
  id: string;
  start: string;
  end: string;
  reason: string;
};

export type BlackoutChange = {
  before: BlackoutPreview;
  after: BlackoutPreview | null;
};

export type CommandResult = {
  command: AiCommand;
  status: "ok" | "error";
  message?: string;
  matchedTasks?: TaskPreview[];
  matchedBlackouts?: BlackoutPreview[];
  candidates?: TaskPreview[];
  blackoutCandidates?: BlackoutPreview[];
  changes?: TaskChange[];
  blackoutChanges?: BlackoutChange[];
  created?: TaskPreview[];
  archived?: TaskPreview[];
  requiresReplan: boolean;
};

export type ExecutionResult = {
  results: CommandResult[];
  replanTriggered: boolean;
};
