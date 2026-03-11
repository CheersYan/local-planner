'use server';

import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';

import {
  serializeSettings,
  type SettingErrors,
  type ValidationResult,
  validateSettingsForm,
} from './config';

export type SettingsFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: SettingErrors;
};

const buildErrorState = (result: Extract<ValidationResult, { ok: false }>): SettingsFormState => ({
  status: 'error',
  message: '请修正表单错误后再提交。',
  errors: result.errors,
});

export const updateSettings = async (
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> => {
  const validation = validateSettingsForm(formData);

  if (!validation.ok) {
    return buildErrorState(validation);
  }

  const values = serializeSettings(validation.value);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: 'dailyCapacityHours' },
        update: { value: values.dailyCapacityHours },
        create: { key: 'dailyCapacityHours', value: values.dailyCapacityHours },
      });

      await tx.setting.upsert({
        where: { key: 'planningHorizonDays' },
        update: { value: values.planningHorizonDays },
        create: { key: 'planningHorizonDays', value: values.planningHorizonDays },
      });

      await tx.setting.upsert({
        where: { key: 'allowWeekendWork' },
        update: { value: values.allowWeekendWork },
        create: { key: 'allowWeekendWork', value: values.allowWeekendWork },
      });
    });

    revalidatePath('/settings');

    return {
      status: 'success',
      message: '设置已保存到本地数据库。',
      errors: {},
    };
  } catch (error) {
    console.error('Failed to update settings', error);

    return {
      status: 'error',
      message: '保存失败，请稍后重试。',
      errors: {},
    };
  }
};
