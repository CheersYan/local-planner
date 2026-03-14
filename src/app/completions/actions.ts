'use server';

import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';
import { generatePlanSlots } from '@/lib/planner/service';

export type CompletionFormField = 'taskId' | 'loggedDate' | 'hoursDone' | 'note';

export type CompletionFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Partial<Record<CompletionFormField, string>>;
};

const normalizeDate = (value: string): Date | null => {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  // Anchor to midday local time to avoid UTC drift when rendering as a date.
  parsed.setHours(12, 0, 0, 0);
  return parsed;
};

const parseHours = (value: FormDataEntryValue | null): number => {
  if (typeof value !== 'string') return Number.NaN;

  return Number(value);
};

export const logCompletion = async (
  _prevState: CompletionFormState,
  formData: FormData,
): Promise<CompletionFormState> => {
  const errors: Partial<Record<CompletionFormField, string>> = {};

  const rawTaskId = (formData.get('taskId') ?? '').toString().trim();
  const taskId = rawTaskId || '';
  if (!taskId) {
    errors.taskId = '请选择任务';
  }

  const loggedDate = normalizeDate((formData.get('loggedDate') ?? '').toString());
  if (!loggedDate) {
    errors.loggedDate = '请选择有效日期';
  }

  const hoursDone = parseHours(formData.get('hoursDone'));
  if (!Number.isFinite(hoursDone) || hoursDone <= 0) {
    errors.hoursDone = '用时必须大于 0';
  }

  const note = (formData.get('note') ?? '').toString().trim();

  const task = taskId
    ? await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, estimateMinutes: true, actualMinutes: true, remainingMinutes: true },
      })
    : null;

  if (taskId && !task) {
    errors.taskId = '任务不存在或已被删除';
  }

  if (Object.keys(errors).length > 0) {
    return {
      status: 'error',
      message: '请修正表单错误后再提交。',
      errors,
    } satisfies CompletionFormState;
  }

  const minutesSpent = Math.round(hoursDone * 60);
  const previousActual = task?.actualMinutes ?? 0;
  const previousRemaining =
    task?.remainingMinutes ?? Math.max((task?.estimateMinutes ?? 0) - previousActual, 0);
  let databaseUpdated = false;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.completionLog.create({
        data: {
          taskId: taskId,
          loggedAt: loggedDate as Date,
          minutesSpent,
          note: note || null,
        },
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          actualMinutes: previousActual + minutesSpent,
          remainingMinutes: Math.max(previousRemaining - minutesSpent, 0),
        },
      });
    });

    databaseUpdated = true;

    await generatePlanSlots();

    revalidatePath('/completions');
    revalidatePath('/tasks');

    return {
      status: 'success',
      message: '完成记录已保存，剩余工时已更新并触发未来计划重算。',
      errors: {},
    } satisfies CompletionFormState;
  } catch (error) {
    console.error('Failed to log completion', error);

    const message = databaseUpdated
      ? '记录已保存，但重排失败，请稍后重试重排。'
      : '保存失败，请稍后重试。';

    if (databaseUpdated) {
      revalidatePath('/completions');
      revalidatePath('/tasks');
    }

    return {
      status: 'error',
      message,
      errors: {},
    } satisfies CompletionFormState;
  }
};
