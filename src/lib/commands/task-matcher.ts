import type { Task } from "@prisma/client";

import type { TaskLocator } from "@/lib/ai/command-schema";
import type { TaskPreview } from "./types";

export type TaskMatchOptions = {
  includeDeleted?: boolean;
  statusPreference?: string[];
  suggestionsLimit?: number;
};

export const normalizeTaskText = (text: string): { normalized: string; compact: string } => {
  const punctuationNormalized = text
    .normalize("NFKC")
    .replace(/[，,。．\.！!？?；;：:、·•~\-—_（）()【】\[\]{}<>《》“”"'‘’]/g, " ");

  const collapsed = punctuationNormalized.trim().replace(/\s+/g, " ").toLowerCase();
  const compact = collapsed.replace(/\s+/g, "");

  return { normalized: collapsed, compact };
};

export const toTaskPreview = (task: Task): TaskPreview => ({
  id: task.id,
  title: task.title,
  status: task.status as TaskPreview["status"],
  estimateMinutes: task.estimateMinutes,
  remainingMinutes: task.remainingMinutes ?? null,
  actualMinutes: task.actualMinutes ?? null,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  priority: task.priority,
  note: task.note ?? null,
  deletedAt: task.deletedAt ? task.deletedAt.toISOString() : null,
  parentTaskId: task.parentTaskId ?? null,
});

type IndexedTask = {
  task: Task;
  normalizedTitle: string;
  compactTitle: string;
};

const defaultStatusPreference = ["active", "paused", "completed", "archived"] as const;
const normalizedDefaultPreference = defaultStatusPreference.map((status) => status.toLowerCase());

const normalizeStatus = (status: string): string => status.toLowerCase();

const uniqueByTaskId = (items: IndexedTask[]): IndexedTask[] => {
  const byId = new Map<string, IndexedTask>();
  items.forEach((item) => {
    if (!byId.has(item.task.id)) {
      byId.set(item.task.id, item);
    }
  });
  return Array.from(byId.values());
};

const pickByStatusPreference = (
  candidates: IndexedTask[],
  statusPreference: string[],
): { match?: IndexedTask; ambiguous?: IndexedTask[] } => {
  if (candidates.length === 0) return {};
  if (candidates.length === 1) return { match: candidates[0] };

  for (const status of statusPreference) {
    const bucket = candidates.filter((item) => normalizeStatus(item.task.status) === status);
    if (bucket.length === 1) return { match: bucket[0] };
    if (bucket.length > 1) return { ambiguous: bucket };
  }

  return { ambiguous: candidates };
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
};

const buildSuggestions = (
  tasks: IndexedTask[],
  needle: { normalized: string; compact: string },
  limit: number,
): IndexedTask[] => {
  if (!needle.normalized || limit <= 0) return [];

  const scored = tasks.map((item) => {
    const normDistance = levenshteinDistance(item.normalizedTitle, needle.normalized);
    const compactDistance = levenshteinDistance(item.compactTitle, needle.compact);
    const normDenominator = Math.max(item.normalizedTitle.length, needle.normalized.length, 1);
    const compactDenominator = Math.max(item.compactTitle.length, needle.compact.length, 1);
    const score = Math.min(normDistance / normDenominator, compactDistance / compactDenominator);
    return { item, score };
  });

  return scored
    .sort((a, b) => a.score - b.score || a.item.normalizedTitle.localeCompare(b.item.normalizedTitle))
    .slice(0, limit)
    .map((entry) => entry.item);
};

const matchesFuzzy = (candidate: IndexedTask, needle: { normalized: string; compact: string }): boolean => {
  const normalizedHit =
    candidate.normalizedTitle.includes(needle.normalized) || needle.normalized.includes(candidate.normalizedTitle);
  const compactHit = candidate.compactTitle.includes(needle.compact) || needle.compact.includes(candidate.compactTitle);

  return normalizedHit || compactHit;
};

export class TaskMatchError extends Error {
  candidates: TaskPreview[];
  suggestions: TaskPreview[];
  code: "not_found" | "ambiguous";

  constructor(
    message: string,
    options: { candidates?: Task[]; suggestions?: Task[]; code?: "not_found" | "ambiguous" } = {},
  ) {
    super(message);
    this.candidates = (options.candidates ?? []).map(toTaskPreview);
    this.suggestions = (options.suggestions ?? []).map(toTaskPreview);
    this.code = options.code ?? "not_found";
  }
}

export const matchTask = (tasks: Task[], locator: TaskLocator, options: TaskMatchOptions = {}): Task => {
  const includeDeleted = options.includeDeleted ?? false;
  const statusPreference = (options.statusPreference ?? normalizedDefaultPreference).map(normalizeStatus);
  const suggestionsLimit = options.suggestionsLimit ?? 3;

  const indexed: IndexedTask[] = tasks.map((task) => {
    const normalizedTitle = normalizeTaskText(task.title);
    return {
      task,
      normalizedTitle: normalizedTitle.normalized,
      compactTitle: normalizedTitle.compact,
    };
  });

  const visible = includeDeleted ? indexed : indexed.filter((item) => item.task.deletedAt === null);

  const applyPreference = (candidates: IndexedTask[]) => pickByStatusPreference(candidates, statusPreference);

  // 1) taskId exact match
  if (locator.taskId) {
    const idHit = visible.find((item) => item.task.id === locator.taskId);
    if (idHit) return idHit.task;
  }

  const titleNeedle = locator.title ? normalizeTaskText(locator.title) : null;

  // 2) normalized exact title match
  if (titleNeedle) {
    const exactNormalized = visible.filter((item) => item.normalizedTitle === titleNeedle.normalized);
    const { match, ambiguous } = applyPreference(exactNormalized);
    if (match) return match.task;
    if (ambiguous) {
      throw new TaskMatchError("Task title is ambiguous", {
        candidates: ambiguous.map((item) => item.task),
        code: "ambiguous",
      });
    }
  }

  // 3) compact exact title match
  if (titleNeedle) {
    const exactCompact = visible.filter((item) => item.compactTitle === titleNeedle.compact);
    const { match, ambiguous } = applyPreference(exactCompact);
    if (match) return match.task;
    if (ambiguous) {
      throw new TaskMatchError("Task title is ambiguous", {
        candidates: ambiguous.map((item) => item.task),
        code: "ambiguous",
      });
    }
  }

  // 4) normalized contains / contained-by fuzzy match
  const fuzzySource = locator.fuzzyTitle ? normalizeTaskText(locator.fuzzyTitle) : titleNeedle;
  if (fuzzySource) {
    const fuzzyCandidates = uniqueByTaskId(visible.filter((item) => matchesFuzzy(item, fuzzySource)));
    const { match, ambiguous } = applyPreference(fuzzyCandidates);
    if (match) return match.task;
    if (ambiguous) {
      throw new TaskMatchError("Task title is ambiguous", {
        candidates: ambiguous.map((item) => item.task),
        code: "ambiguous",
      });
    }
  }

  const suggestionNeedle = fuzzySource ?? titleNeedle;
  const suggestions = suggestionNeedle ? buildSuggestions(visible, suggestionNeedle, suggestionsLimit) : [];

  throw new TaskMatchError("Task not found", {
    suggestions: suggestions.map((item) => item.task),
    code: "not_found",
  });
};
