"use client";

import {
  type ReactNode,
  useActionState,
  useEffect,
  useRef,
} from "react";

import { createTask, type TaskFormState } from "./actions";

const initialState: TaskFormState = {
  status: "idle",
  errors: {},
};

type FieldProps = {
  label: string;
  name: string;
  children: ReactNode;
  error?: string;
  helper?: string;
};

const Field = ({ label, name, children, error, helper }: FieldProps) => {
  return (
    <div className="space-y-2">
      <label
        htmlFor={name}
        className="flex items-center gap-2 text-sm font-medium text-foreground"
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
};

export function TaskForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState<TaskFormState, FormData>(
    createTask,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-8"
      noValidate
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Field
          label="Title"
          name="title"
          error={state.errors?.title}
          helper="简短描述任务要做的事情。"
        >
          <input
            id="title"
            name="title"
            required
            type="text"
            placeholder="例如：完成迭代交付包"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring"
            aria-invalid={Boolean(state.errors?.title)}
          />
        </Field>

        <Field
          label="Estimate (hours)"
          name="estimateHours"
          error={state.errors?.estimateHours}
          helper="用小时填写，可输入小数；稍后会转换为分钟存入数据库。"
        >
          <input
            id="estimateHours"
            name="estimateHours"
            type="number"
            min={0.25}
            step={0.25}
            required
            inputMode="decimal"
            placeholder="例如：1.5"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring"
            aria-invalid={Boolean(state.errors?.estimateHours)}
          />
        </Field>

        <Field
          label="Due date"
          name="dueDate"
          error={state.errors?.dueDate}
          helper="可选。留空则无截止日期。"
        >
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring"
            aria-invalid={Boolean(state.errors?.dueDate)}
          />
        </Field>

        <Field
          label="Priority"
          name="priority"
          error={state.errors?.priority}
          helper="非负整数，数字越大优先级越高，默认 0。"
        >
          <input
            id="priority"
            name="priority"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="0"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base shadow-sm ring-2 ring-transparent transition focus-visible:outline-none focus-visible:ring-ring"
            aria-invalid={Boolean(state.errors?.priority)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Saving…" : "Save task"}
        </button>
        {state.status === "success" ? (
          <p className="text-sm text-success" role="status">
            {state.message ?? "任务已保存。"}
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
