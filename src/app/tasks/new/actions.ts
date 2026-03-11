'use server';

import { prisma } from '@/lib/prisma';

export type TaskFormField = 'title' | 'estimateHours' | 'dueDate' | 'priority';

export type TaskFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Partial<Record<TaskFormField, string>>;
};

const normalizeDate = (value: string): Date | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

export const createTask = async (
  _prevState: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> => {
  const errors: Partial<Record<TaskFormField, string>> = {};

  const rawTitle = (formData.get('title') ?? '').toString().trim();
  if (!rawTitle) {
    errors.title = '标题必填';
  }

  const rawEstimate = formData.get('estimateHours');
  const estimateHours = typeof rawEstimate === 'string' ? Number(rawEstimate) : NaN;
  if (!Number.isFinite(estimateHours) || estimateHours <= 0) {
    errors.estimateHours = '预估工时必须大于 0';
  }

  const rawPriority = formData.get('priority');
  const priority = typeof rawPriority === 'string' && rawPriority !== '' ? Number(rawPriority) : 0;
  if (!Number.isInteger(priority) || priority < 0) {
    errors.priority = '优先级需为非负整数';
  }

  const rawDueDate = (formData.get('dueDate') ?? '').toString();
  let dueDate: Date | null = null;
  if (rawDueDate) {
    const parsed = normalizeDate(rawDueDate);
    if (!parsed) {
      errors.dueDate = '无效日期格式';
    } else {
      dueDate = parsed;
    }
  }

  if (Object.keys(errors).length > 0) {
    return {
      status: 'error',
      message: '请修正表单错误后再提交。',
      errors,
    } satisfies TaskFormState;
  }

  const estimateMinutes = Math.round(estimateHours * 60);

  try {
    await prisma.task.create({
      data: {
        title: rawTitle,
        status: 'planned',
        estimateMinutes,
        priority,
        dueDate,
        locked: false,
      },
    });

    return {
      status: 'success',
      message: '任务已保存到本地数据库。',
      errors: {},
    } satisfies TaskFormState;
  } catch (error) {
    console.error('Failed to create task', error);

    return {
      status: 'error',
      message: '保存失败，请稍后重试。',
      errors: {},
    } satisfies TaskFormState;
  }
};
