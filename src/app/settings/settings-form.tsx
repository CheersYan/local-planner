"use client";

import {
  useActionState,
  useState,
} from "react";

import type { PlannerSettings } from "./config";
import { updateSettings, type SettingsFormState } from "./actions";

const initialState: SettingsFormState = {
  status: "idle",
  errors: {},
};

type FormValues = {
  dailyCapacityHours: string;
  planningHorizonDays: string;
  allowWeekendWork: boolean;
};

type FieldProps = {
  label: string;
  name: string;
  error?: string;
  helper?: string;
  children: React.ReactNode;
};

const Field = ({ label, name, error, helper, children }: FieldProps) => (
  <div className="space-y-2">
    <label
      htmlFor={name}
      className="flex items-center gap-2 text-sm font-semibold text-foreground"
    >
      {label}
    </label>
    {children}
    {error ? (
      <p className="text-sm text-danger" aria-live="polite">
        {error}
      </p>
    ) : helper ? (
      <p className="text-sm text-muted-foreground">{helper}</p>
    ) : null}
  </div>
);

type SettingsFormProps = {
  initialValues: PlannerSettings;
};

export function SettingsForm({ initialValues }: SettingsFormProps) {
  const [state, formAction, isPending] = useActionState<SettingsFormState, FormData>(
    updateSettings,
    initialState,
  );

  const [values, setValues] = useState<FormValues>({
    dailyCapacityHours: initialValues.dailyCapacityHours.toString(),
    planningHorizonDays: initialValues.planningHorizonDays.toString(),
    allowWeekendWork: initialValues.allowWeekendWork,
  });

  const formKey = `${initialValues.dailyCapacityHours}-${initialValues.planningHorizonDays}-${initialValues.allowWeekendWork}`;

  return (
    <form key={formKey} action={formAction} className="space-y-8" noValidate>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Field
          label="Daily capacity (hours)"
          name="dailyCapacityHours"
          error={state.errors?.dailyCapacityHours}
          helper="用于生成每日日程的可用工时，默认 8 小时。"
        >
          <input
            id="dailyCapacityHours"
            name="dailyCapacityHours"
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            required
            value={values.dailyCapacityHours}
            onChange={(event) =>
              setValues((prev) => ({
                ...prev,
                dailyCapacityHours: event.target.value,
              }))
            }
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring"
            aria-invalid={Boolean(state.errors?.dailyCapacityHours)}
          />
        </Field>

        <Field
          label="Planning horizon (days)"
          name="planningHorizonDays"
          error={state.errors?.planningHorizonDays}
          helper="滚动规划窗口，影响未来几天的分配（默认 14 天）。"
        >
          <input
            id="planningHorizonDays"
            name="planningHorizonDays"
            type="number"
            min={1}
            max={60}
            step={1}
            required
            value={values.planningHorizonDays}
            onChange={(event) =>
              setValues((prev) => ({
                ...prev,
                planningHorizonDays: event.target.value,
              }))
            }
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring"
            aria-invalid={Boolean(state.errors?.planningHorizonDays)}
          />
        </Field>
      </div>

      <div className="space-y-3 rounded-2xl bg-surface/70 px-4 py-4 ring-1 ring-border/70">
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input
            id="allowWeekendWork"
            name="allowWeekendWork"
            type="checkbox"
            value="true"
            checked={values.allowWeekendWork}
            onChange={(event) =>
              setValues((prev) => ({
                ...prev,
                allowWeekendWork: event.target.checked,
              }))
            }
            className="mt-1 h-4 w-4 rounded border-border text-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        <div className="space-y-1">
          <span className="font-semibold">Allow weekend work</span>
          <p className="text-muted-foreground">
            开启后周六日也会被计入规划窗口；关闭则视为不可用日。
          </p>
          </div>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Saving…" : "Save settings"}
        </button>

        {state.status === "success" ? (
          <p className="text-sm text-success" role="status">
            {state.message}
          </p>
        ) : state.status === "error" && state.message ? (
          <p className="text-sm text-danger" role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
