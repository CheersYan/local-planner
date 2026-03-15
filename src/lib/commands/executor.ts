import type { BlackoutWindow, Prisma, Task } from "@prisma/client";

import * as plannerService from "../planner/service";
import { prisma } from "../prisma";
import type { AiCommand, AiCommandBatch, BlackoutLocator, TaskLocator } from "../ai/command-schema";
import { aiCommandBatchSchema } from "../ai/command-schema";
import { matchBlackout, BlackoutMatchError, toBlackoutPreview } from "./blackout-matcher";
import { matchTask, TaskMatchError, toTaskPreview, type TaskMatchOptions } from "./task-matcher";
import type { BlackoutPreview, CommandResult, ExecutionResult, TaskPreview } from "./types";

export class CommandExecutionError extends Error {
  results: CommandResult[];

  constructor(message: string, results: CommandResult[]) {
    super(message);
    this.results = results;
  }
}

const startOfDay = (value: Date): Date => {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const startOfDayIso = (isoDate: string): string => `${isoDate}T00:00:00Z`;
const endOfDayIso = (isoDate: string): string => `${isoDate}T23:59:59Z`;
const isoDateOnly = (isoDateTime: string): string => isoDateTime.slice(0, 10);

const toDateOrNull = (iso: string | null | undefined): Date | null => {
  if (iso === undefined) return null;
  if (iso === null) return null;
  return new Date(`${iso}T00:00:00Z`);
};

const snapshotBlackout = (window: BlackoutWindow): BlackoutPreview => toBlackoutPreview(window);

const snapshot = toTaskPreview;

const computeRemaining = (task: Task): number =>
  task.remainingMinutes ?? Math.max(task.estimateMinutes - (task.actualMinutes ?? 0), 0);

const deleteFutureSlots = (tx: Prisma.TransactionClient, taskId: string, today: Date) =>
  tx.planSlot.deleteMany({
    where: { taskId, slotDate: { gte: today } },
  });

const restoreStatusPreference = ["archived", "completed", "paused", "active"];
const reopenStatusPreference = ["completed", "archived", "active", "paused"];

const ensureActive = (task: Task, command: AiCommand) => {
  if (task.deletedAt) {
    throw new CommandExecutionError("Task is deleted", [
      { command, status: "error", message: "Task is deleted", requiresReplan: false },
    ]);
  }
};

const createTask = async (
  tx: Prisma.TransactionClient,
  data: Prisma.TaskCreateInput,
): Promise<Task> => tx.task.create({ data });

const applyCommand = async (
  tx: Prisma.TransactionClient,
  command: AiCommand,
  today: Date,
  dryRun: boolean,
): Promise<{ result: CommandResult; requiresReplan: boolean }> => {
  let cachedTasks: Task[] | null = null;
  const loadTasks = async (): Promise<Task[]> => {
    if (!cachedTasks) {
      cachedTasks = await tx.task.findMany();
    }
    return cachedTasks;
  };

  const resolve = async (locator: TaskLocator, options: TaskMatchOptions = {}) => {
    const tasks = await loadTasks();
    try {
      return matchTask(tasks, locator, { suggestionsLimit: 3, ...options });
    } catch (error) {
      if (error instanceof TaskMatchError) {
        throw new CommandExecutionError(error.message, [
          {
            command,
            status: "error",
            message: error.message,
            candidates: error.candidates,
            suggestions: error.suggestions,
            requiresReplan: false,
          },
        ]);
      }
      throw error;
    }
  };

  switch (command.type) {
    case "create_tasks": {
      const created: TaskPreview[] = [];
      for (const task of command.payload.tasks) {
        if (dryRun) {
          created.push({
            id: `preview-create-${task.title}`,
            title: task.title,
            status: "active",
            estimateMinutes: task.estimateMinutes,
            remainingMinutes: task.estimateMinutes,
            actualMinutes: 0,
            dueDate: task.dueDate ?? null,
            priority: task.priority,
            note: task.note ?? null,
            deletedAt: null,
            parentTaskId: null,
          });
        } else {
          const record = await createTask(tx, {
            title: task.title,
            status: "active",
            estimateMinutes: task.estimateMinutes,
            remainingMinutes: task.estimateMinutes,
            priority: task.priority,
            dueDate: toDateOrNull(task.dueDate ?? null),
            plannedDate: null,
            locked: task.locked,
            note: task.note ?? null,
          });
          created.push(snapshot(record));
        }
      }

      return {
        result: {
          command,
          status: "ok",
          created,
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "add_urgent_task": {
      if (dryRun) {
        return {
          result: {
            command,
            status: "ok",
            created: [
              {
                id: "preview-urgent",
                title: command.payload.title,
                status: "active",
                estimateMinutes: command.payload.estimateMinutes,
                remainingMinutes: command.payload.estimateMinutes,
                dueDate: command.payload.dueDate,
                priority: command.payload.priority,
                note: command.payload.note ?? null,
                deletedAt: null,
                parentTaskId: null,
              },
            ],
            requiresReplan: true,
          },
          requiresReplan: true,
        };
      }

      const urgent = await createTask(tx, {
        title: command.payload.title,
        status: "active",
        estimateMinutes: command.payload.estimateMinutes,
        remainingMinutes: command.payload.estimateMinutes,
        priority: command.payload.priority,
        dueDate: toDateOrNull(command.payload.dueDate),
        plannedDate: null,
        locked: false,
        note: command.payload.note ?? null,
      });

      return {
        result: {
          command,
          status: "ok",
          created: [snapshot(urgent)],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "add_blackout": {
      if (dryRun) {
        return {
          result: {
            command,
            status: "ok",
            requiresReplan: true,
          },
          requiresReplan: true,
        };
      }

      await tx.blackoutWindow.create({
        data: {
          start: new Date(command.payload.start),
          end: new Date(command.payload.end),
          reason: command.payload.reason,
        },
      });

      return {
        result: {
          command,
          status: "ok",
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "update_blackout_window": {
      const windows = await tx.blackoutWindow.findMany();
      const previews = windows.map(snapshotBlackout);

      try {
        const matched = matchBlackout(previews, command.payload.target as BlackoutLocator);
        const nextStartDate = command.payload.startDate ?? isoDateOnly(matched.start);
        const nextEndDate = command.payload.endDate ?? isoDateOnly(matched.end);
        const nextReason = command.payload.reason ?? matched.reason;
        const requiresReplan = command.payload.startDate !== undefined || command.payload.endDate !== undefined;

        const after: BlackoutPreview = {
          id: matched.id,
          start: startOfDayIso(nextStartDate),
          end: endOfDayIso(nextEndDate),
          reason: nextReason,
        };

        if (new Date(after.end).getTime() < new Date(after.start).getTime()) {
          throw new CommandExecutionError("endDate must be on or after startDate", [
            {
              command,
              status: "error",
              message: "endDate must be on or after startDate",
              matchedBlackouts: [matched],
              requiresReplan: false,
            },
          ]);
        }

        if (!dryRun) {
          const updated = await tx.blackoutWindow.update({
            where: { id: matched.id },
            data: {
              ...(command.payload.startDate !== undefined ? { start: new Date(after.start) } : {}),
              ...(command.payload.endDate !== undefined ? { end: new Date(after.end) } : {}),
              ...(command.payload.reason !== undefined ? { reason: nextReason } : {}),
            },
          });

          after.start = updated.start.toISOString();
          after.end = updated.end.toISOString();
          after.reason = updated.reason;
        }

        return {
          result: {
            command,
            status: "ok",
            matchedBlackouts: [matched],
            blackoutChanges: [{ before: matched, after }],
            requiresReplan,
          },
          requiresReplan,
        };
      } catch (error) {
        if (error instanceof BlackoutMatchError) {
          throw new CommandExecutionError(error.message, [
            {
              command,
              status: "error",
              blackoutCandidates: error.candidates,
              requiresReplan: false,
            },
          ]);
        }

        throw error;
      }
    }
    case "delete_blackout_window": {
      const windows = await tx.blackoutWindow.findMany();
      const previews = windows.map(snapshotBlackout);

      try {
        const matched = matchBlackout(previews, command.payload.target as BlackoutLocator);
        if (!dryRun) {
          await tx.blackoutWindow.delete({ where: { id: matched.id } });
        }

        return {
          result: {
            command,
            status: "ok",
            matchedBlackouts: [matched],
            blackoutChanges: [{ before: matched, after: null }],
            requiresReplan: true,
          },
          requiresReplan: true,
        };
      } catch (error) {
        if (error instanceof BlackoutMatchError) {
          throw new CommandExecutionError(error.message, [
            {
              command,
              status: "error",
              blackoutCandidates: error.candidates,
              requiresReplan: false,
            },
          ]);
        }

        throw error;
      }
    }
    case "log_completion": {
      const locator: TaskLocator = {
        taskId: command.payload.taskId,
        title: command.payload.title ?? undefined,
        fuzzyTitle: command.payload.title ?? undefined,
      };
      const task = await resolve(locator);
      ensureActive(task, command);
      const before = snapshot(task);
      const minutesSpent = command.payload.minutesSpent ?? 0;
      const newActual = (task.actualMinutes ?? 0) + minutesSpent;
      const newRemaining = Math.max(computeRemaining(task) - minutesSpent, 0);

      if (!dryRun) {
        await tx.completionLog.create({
          data: {
            taskId: task.id,
            loggedAt: command.payload.loggedAt ? new Date(command.payload.loggedAt) : new Date(),
            minutesSpent: minutesSpent || null,
            note: command.payload.note ?? null,
          },
        });

        await tx.task.update({
          where: { id: task.id },
          data: {
            actualMinutes: newActual,
            remainingMinutes: newRemaining,
            status: command.payload.markDone ? "completed" : task.status,
          },
        });
      }

      const after: TaskPreview = {
        ...before,
        actualMinutes: newActual,
        remainingMinutes: newRemaining,
        status: command.payload.markDone ? "completed" : before.status,
      };

      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "shrink_task": {
      const task = await resolve({ taskId: command.payload.taskId, title: undefined, fuzzyTitle: undefined });
      ensureActive(task, command);
      const before = snapshot(task);
      const newRemaining = command.payload.newRemainingMinutes;

      if (!dryRun) {
        await tx.task.update({
          where: { id: task.id },
          data: { remainingMinutes: newRemaining },
        });
      }

      const after: TaskPreview = { ...before, remainingMinutes: newRemaining };
      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "update_task_fields": {
      const task = await resolve(command.payload.target);
      ensureActive(task, command);
      const before = snapshot(task);
      const data: Prisma.TaskUpdateInput = {};

      if (command.payload.title !== undefined) data.title = command.payload.title;
      if (command.payload.estimateMinutes !== undefined) data.estimateMinutes = command.payload.estimateMinutes;
      if (command.payload.remainingMinutes !== undefined)
        data.remainingMinutes = Math.max(0, command.payload.remainingMinutes);
      if (command.payload.dueDate !== undefined) data.dueDate = toDateOrNull(command.payload.dueDate);
      if (command.payload.priority !== undefined) data.priority = command.payload.priority;
      if (command.payload.note !== undefined) data.note = command.payload.note;

      const updated = dryRun
        ? ({ ...task, ...data } as Task)
        : await tx.task.update({ where: { id: task.id }, data });
      const replan =
        command.payload.estimateMinutes !== undefined ||
        command.payload.remainingMinutes !== undefined ||
        command.payload.dueDate !== undefined ||
        command.payload.priority !== undefined;

      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: replan,
        },
        requiresReplan: replan,
      };
    }
    case "reschedule_task": {
      const task = await resolve(command.payload.target);
      ensureActive(task, command);
      const before = snapshot(task);
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { dueDate: toDateOrNull(command.payload.dueDate) },
      });

      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "reprioritize_task": {
      const task = await resolve(command.payload.target);
      ensureActive(task, command);
      const before = snapshot(task);
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { priority: command.payload.priority },
      });
      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "pause_task": {
      const task = await resolve(command.payload.target);
      ensureActive(task, command);
      const before = snapshot(task);
      if (!dryRun) {
        await deleteFutureSlots(tx, task.id, today);
      }
      const updated = dryRun
        ? ({ ...task, status: "paused" } as Task)
        : await tx.task.update({
            where: { id: task.id },
            data: { status: "paused" },
          });
      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "resume_task": {
      const task = await resolve(command.payload.target);
      const before = snapshot(task);
      const updated = dryRun
        ? ({ ...task, status: "active", deletedAt: null } as Task)
        : await tx.task.update({
            where: { id: task.id },
            data: { status: "active", deletedAt: null },
          });
      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "delete_task": {
      const task = await resolve(command.payload.target);
      ensureActive(task, command);
      const before = snapshot(task);
      if (!dryRun) {
        await deleteFutureSlots(tx, task.id, today);
      }
      const updated = dryRun
        ? ({ ...task, status: "archived", deletedAt: new Date() } as Task)
        : await tx.task.update({
            where: { id: task.id },
            data: { status: "archived", deletedAt: new Date() },
          });
      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "restore_task": {
      const task = await resolve(command.payload.target, {
        includeDeleted: true,
        statusPreference: restoreStatusPreference,
      });
      const before = snapshot(task);
      const updated = dryRun
        ? ({ ...task, status: "active", deletedAt: null } as Task)
        : await tx.task.update({
            where: { id: task.id },
            data: { status: "active", deletedAt: null },
          });
      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "mark_task_done": {
      const task = await resolve(command.payload.target);
      ensureActive(task, command);
      const before = snapshot(task);
      if (!dryRun) {
        await deleteFutureSlots(tx, task.id, today);
      }
      const updated = dryRun
        ? ({ ...task, status: "completed", remainingMinutes: 0 } as Task)
        : await tx.task.update({
            where: { id: task.id },
            data: { status: "completed", remainingMinutes: 0 },
          });
      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "reopen_task": {
      if (command.payload.remainingMinutes <= 0) {
        throw new CommandExecutionError("remainingMinutes must be > 0", [
          { command, status: "error", requiresReplan: false },
        ]);
      }
      const task = await resolve(command.payload.target, {
        includeDeleted: true,
        statusPreference: reopenStatusPreference,
      });
      const before = snapshot(task);
      const updated = dryRun
        ? ({
            ...task,
            status: "active",
            deletedAt: null,
            remainingMinutes: command.payload.remainingMinutes,
          } as Task)
        : await tx.task.update({
            where: { id: task.id },
            data: {
              status: "active",
              deletedAt: null,
              remainingMinutes: command.payload.remainingMinutes,
            },
          });
      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          changes: [{ before, after: snapshot(updated) }],
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "split_task": {
      const task = await resolve(command.payload.target);
      ensureActive(task, command);
      const before = snapshot(task);
      if (!dryRun) {
        await deleteFutureSlots(tx, task.id, today);
      }

      const created: TaskPreview[] = [];

      for (const [index, part] of command.payload.parts.entries()) {
        const estimate = part.estimateMinutes ?? part.remainingMinutes ?? 0;
        const remaining = part.remainingMinutes ?? part.estimateMinutes ?? 0;
        const dueDateIso = part.dueDate ?? task.dueDate?.toISOString().slice(0, 10) ?? null;
        if (dryRun) {
          created.push({
            ...before,
            id: `preview-split-${index}`,
            title: part.title,
            estimateMinutes: estimate,
            remainingMinutes: remaining,
            status: "active",
            dueDate: dueDateIso,
            priority: part.priority ?? task.priority,
            note: part.note ?? task.note,
            parentTaskId: task.id,
            deletedAt: null,
          });
        } else {
          const newTask = await createTask(tx, {
            title: part.title,
            status: "active",
            estimateMinutes: estimate,
            remainingMinutes: remaining,
            priority: part.priority ?? task.priority,
            dueDate: toDateOrNull(dueDateIso),
            plannedDate: null,
            locked: false,
            parentTask: { connect: { id: task.id } },
            note: part.note ?? task.note,
          });
          created.push(snapshot(newTask));
        }
      }

      const archived = dryRun
        ? ({ ...task, status: "archived", deletedAt: new Date(), remainingMinutes: 0 } as Task)
        : await tx.task.update({
            where: { id: task.id },
            data: { status: "archived", deletedAt: new Date(), remainingMinutes: 0 },
          });

      return {
        result: {
          command,
          status: "ok",
          matchedTasks: [before],
          archived: [snapshot(archived)],
          created,
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    case "merge_tasks": {
      const sourceTasks: Task[] = [];
      for (const locator of command.payload.targets) {
        const task = await resolve(locator);
        ensureActive(task, command);
        sourceTasks.push(task);
      }

      const before = sourceTasks.map(snapshot);
      if (!dryRun) {
        for (const task of sourceTasks) {
          await deleteFutureSlots(tx, task.id, today);
        }
      }

      const sumRemaining = sourceTasks.reduce((sum, task) => sum + computeRemaining(task), 0);
      const highestPriority = Math.max(...sourceTasks.map((t) => t.priority));
      const latestDue = sourceTasks
        .map((t) => t.dueDate)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => (a && b ? b.getTime() - a.getTime() : 0))[0];

      const mergedTask =
        dryRun
          ? ({
              ...before[0],
              id: "preview-merged",
              title: command.payload.title,
              status: "active",
              estimateMinutes: command.payload.estimateMinutes ?? command.payload.remainingMinutes ?? sumRemaining,
              remainingMinutes: command.payload.remainingMinutes ?? sumRemaining,
              priority: command.payload.priority ?? highestPriority,
              dueDate: toDateOrNull(
                command.payload.dueDate ??
                  (latestDue ? latestDue.toISOString().slice(0, 10) : null),
              ),
              plannedDate: null,
              locked: false,
              note: command.payload.note ?? null,
              parentTaskId: null,
              deletedAt: null,
            } as Task)
          : await createTask(tx, {
              title: command.payload.title,
              status: "active",
              estimateMinutes: command.payload.estimateMinutes ?? command.payload.remainingMinutes ?? sumRemaining,
              remainingMinutes: command.payload.remainingMinutes ?? sumRemaining,
              priority: command.payload.priority ?? highestPriority,
              dueDate: toDateOrNull(
                command.payload.dueDate ??
                  (latestDue ? latestDue.toISOString().slice(0, 10) : null),
              ),
              plannedDate: null,
              locked: false,
              note: command.payload.note ?? null,
            });

      const archivedSnapshots: TaskPreview[] = [];
      for (const task of sourceTasks) {
        if (dryRun) {
          archivedSnapshots.push({
            ...snapshot(task),
            status: "archived",
            deletedAt: new Date().toISOString(),
            parentTaskId: mergedTask.id,
          });
        } else {
          const updated = await tx.task.update({
            where: { id: task.id },
            data: { status: "archived", deletedAt: new Date(), parentTaskId: mergedTask.id },
          });
          archivedSnapshots.push(snapshot(updated));
        }
      }

      return {
        result: {
          command,
          status: "ok",
          matchedTasks: before,
          created: [snapshot(mergedTask)],
          archived: archivedSnapshots,
          requiresReplan: true,
        },
        requiresReplan: true,
      };
    }
    default: {
      const unreachable: never = command;
      throw new CommandExecutionError("Command is not supported for execution", [
        { command: unreachable, status: "error", requiresReplan: false },
      ]);
    }
  }
};

export const executeCommandBatch = async (
  commands: AiCommandBatch,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<ExecutionResult> => {
  const validated = aiCommandBatchSchema.parse(commands);
  const results: CommandResult[] = [];
  const now = options.now ?? new Date();
  const today = startOfDay(now);
  const dryRun = options.dryRun ?? false;
  let replanNeeded = false;

  try {
    const runner = async (tx: Prisma.TransactionClient) => {
      for (const command of validated) {
        const { result, requiresReplan } = await applyCommand(tx, command, today, dryRun);
        results.push(result);
        replanNeeded ||= requiresReplan;
      }
    };

    if (dryRun) {
      // read-only path
      const tx = await prisma.$transaction(async (transaction) => {
        await runner(transaction);
        return null;
      });
      void tx;
    } else {
      await prisma.$transaction(runner);
    }
  } catch (error) {
    if (error instanceof CommandExecutionError) {
      const failureResults = error.results.length > 0 ? error.results : [];
      return { results: failureResults, replanTriggered: false };
    }

    throw error;
  }

  const shouldReplan = replanNeeded || results.some((result) => result.requiresReplan);

  let replanTriggered = false;
  if (shouldReplan && !dryRun) {
    await plannerService.generatePlanSlots({ now });
    replanTriggered = true;
  }

  return { results, replanTriggered };
};
