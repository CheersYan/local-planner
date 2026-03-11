import type { Setting } from "@prisma/client";

export type PlannerSettingKey = "dailyCapacityHours" | "planningHorizonDays" | "allowWeekendWork";

export type PlannerSettings = {
  dailyCapacityHours: number;
  planningHorizonDays: number;
  allowWeekendWork: boolean;
};

export type SettingErrors = Partial<Record<PlannerSettingKey, string>>;

export const SETTING_KEYS: PlannerSettingKey[] = [
  "dailyCapacityHours",
  "planningHorizonDays",
  "allowWeekendWork",
];

export const DEFAULT_SETTINGS: PlannerSettings = {
  dailyCapacityHours: 8,
  planningHorizonDays: 14,
  allowWeekendWork: false,
};

type SettingMap = Partial<Record<PlannerSettingKey, string>>;

const toSettingMap = (records: Pick<Setting, "key" | "value">[]): SettingMap => {
  return records.reduce<SettingMap>((acc, record) => {
    if (SETTING_KEYS.includes(record.key as PlannerSettingKey)) {
      acc[record.key as PlannerSettingKey] = record.value;
    }
    return acc;
  }, {});
};

const parseHours = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24) return fallback;

  return Math.round(parsed * 4) / 4;
};

const parseDays = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 60) return fallback;

  return parsed;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

export const materializeSettings = (records: Pick<Setting, "key" | "value">[]): PlannerSettings => {
  const map = toSettingMap(records);

  return {
    dailyCapacityHours: parseHours(map.dailyCapacityHours, DEFAULT_SETTINGS.dailyCapacityHours),
    planningHorizonDays: parseDays(map.planningHorizonDays, DEFAULT_SETTINGS.planningHorizonDays),
    allowWeekendWork: parseBoolean(map.allowWeekendWork, DEFAULT_SETTINGS.allowWeekendWork),
  };
};

export type ValidationResult =
  | { ok: true; value: PlannerSettings }
  | { ok: false; errors: SettingErrors };

export const validateSettingsForm = (formData: FormData): ValidationResult => {
  const errors: SettingErrors = {};

  const rawHours = formData.get("dailyCapacityHours");
  const parsedHours = typeof rawHours === "string" ? Number(rawHours) : NaN;
  if (!Number.isFinite(parsedHours) || parsedHours <= 0 || parsedHours > 24) {
    errors.dailyCapacityHours = "每日可用时间需在 0.25–24 小时之间。";
  }

  const rawHorizon = formData.get("planningHorizonDays");
  const parsedHorizon = typeof rawHorizon === "string" ? Number(rawHorizon) : NaN;
  if (!Number.isInteger(parsedHorizon) || parsedHorizon <= 0 || parsedHorizon > 60) {
    errors.planningHorizonDays = "规划窗口需为 1–60 天的整数。";
  }

  const allowWeekendWork =
    formData.get("allowWeekendWork") === "true" || formData.get("allowWeekendWork") === "on";

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      dailyCapacityHours: Math.round(parsedHours * 4) / 4,
      planningHorizonDays: parsedHorizon,
      allowWeekendWork,
    },
  };
};

export const serializeSettings = (settings: PlannerSettings): Record<PlannerSettingKey, string> => ({
  dailyCapacityHours: settings.dailyCapacityHours.toString(),
  planningHorizonDays: settings.planningHorizonDays.toString(),
  allowWeekendWork: settings.allowWeekendWork ? "true" : "false",
});
