"use client";

import {
  type ReactNode,
  useActionState,
  useEffect,
  useRef,
} from "react";

import { logCompletion, type CompletionFormState } from "./actions";

type PlannerTaskStatus = "planned" | "in_progress" | "done" | "dropped";

export type CompletionFormTask = {
  id: string;
  title: string;
  remainingHours: number;
  status: PlannerTaskStatus;
};

type CompletionFormProps = {
  tasks: CompletionFormTask[];
  defaultDate: string;
};

type FieldProps = {
  label: string;
  name: string;
  children: ReactNode;
  error?: string;
  helper?: string;
  fullWidth?: boolean;
};

const Field = ({ label, name, children, error, helper, fullWidth = false }: FieldProps) => {
  return (
    <div className={`space-y-2 ${fullWidth ? "md:col-span-2" : ""}`}>
      <label htmlFor={name} className="flex items-center gap-2 text-sm font-medium text-foreground">
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
};

const initialState: CompletionFormState = {
  status: "idle",
  errors: {},
};

const formatHours = (hours: number): string => (Number.isInteger(hours) ? hours.toString() : hours.toFixed(1));

export function CompletionForm({ tasks, defaultDate }: CompletionFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState<CompletionFormState, FormData>(
    logCompletion,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  const hasTasks = tasks.length > 0;

  return (
    <form ref={formRef} action={formAction} className="space-y-8" noValidate>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Field
          label="Task"
          name="taskId"
          error={state.errors?.taskId}
          helper={hasTasks ? "选择要记录的任务，显示剩余工时与状态。" : "当前没有任务可选，请先创建任务。"}
        >
          <select
            id="taskId"
            name="taskId"
            required
            disabled={!hasTasks || isPending}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
            aria-invalid={Boolean(state.errors?.taskId)}
            defaultValue=""
          >
            <option value="" disabled>
              {hasTasks ? "Select a task" : "No tasks available"}
            </option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · Remaining {formatHours(task.remainingHours)}h · status{" "}
                {task.status.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Date"
          name="loggedDate"
          error={state.errors?.loggedDate}
          helper="默认今天；重排仅影响今天和未来。"
        >
          <input
            id="loggedDate"
            name="loggedDate"
            type="date"
            required
            defaultValue={defaultDate}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
            aria-invalid={Boolean(state.errors?.loggedDate)}
          />
        </Field>

        <Field
          label="Hours done"
          name="hoursDone"
          error={state.errors?.hoursDone}
          helper="用小时填写，可输入小数；将换算为分钟并累加到 actualMinutes。"
        >
          <input
            id="hoursDone"
            name="hoursDone"
            type="number"
            min={0.25}
            step={0.25}
            required
            inputMode="decimal"
            placeholder="例如：1.5"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring"
            aria-invalid={Boolean(state.errors?.hoursDone)}
          />
        </Field>

        <Field
          label="Note"
          name="note"
          helper="可选。记录上下文或下一步提醒。"
          fullWidth
        >
          <textarea
            id="note"
            name="note"
            rows={3}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring"
            aria-invalid={Boolean(state.errors?.note)}
            placeholder="例如：完成了接口对接，剩余联调。"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={!hasTasks || isPending}
          className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Saving…" : "Save log & replan"}
        </button>
        {state.status === "success" ? (
          <p className="text-sm text-success" role="status">
            {state.message ?? "完成记录已保存。"}
          </p>
        ) : state.status === "error" ? (
          <p className="text-sm text-danger" role="status">
            {state.message ?? "保存失败，请稍后再试。"}
          </p>
        ) : null}
      </div>
    </form>
  );
}
