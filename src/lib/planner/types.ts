export type ISODateString = string; // e.g. "2026-03-11"
export type ISODateTimeString = string; // e.g. "2026-03-11T09:00:00+10:00"

/**
 * Keep planner types independent from Prisma so the planner stays a pure domain module.
 * If your app uses Prisma enums, they are usually assignable to these string unions.
 */
export type TaskStatus = "todo" | "planned" | "in_progress" | "done" | "dropped";

export type PlannerTask = {
  id: string;
  title: string;
  status: TaskStatus;
  estimateMinutes: number;
  actualMinutes?: number;
  dueDate?: ISODateString;
  plannedDate?: ISODateString;
  priority: number;
  locked: boolean;
};

export type PlannerSlot = {
  id: string;
  taskId: string;
  slotDate: ISODateString;
  plannedMinutes: number;
  position: number;
  locked: boolean;
};

export type PlannerBlackout = {
  id: string;
  start: ISODateTimeString;
  end: ISODateTimeString;
  reason: string;
};

export type PlannerGoal = {
  id: string;
  startDate: ISODateString;
  endDate: ISODateString;
  targetTasks?: number;
  targetMinutes?: number;
};

export type PlannerCommand =
  | {
      type: "set_goal";
      payload: {
        days: number;
        targetTasks?: number;
        targetMinutes?: number;
      };
    }
  | {
      type: "log_done";
      payload: {
        taskId?: string;
        title?: string;
        minutesSpent?: number;
        note?: string;
      };
    }
  | {
      type: "tune_estimate";
      payload: {
        taskId: string;
        estimateMinutes: number;
      };
    }
  | {
      type: "set_blackout";
      payload: {
        start: ISODateTimeString;
        end: ISODateTimeString;
        reason: string;
      };
    }
  | {
      type: "add_task";
      payload: {
        title: string;
        estimateMinutes: number;
        dueDate?: ISODateString;
        priority?: number;
      };
    };

export type PlannerInboxItem = {
  id: string;
  command: PlannerCommand;
  status: string;
  createdAt: ISODateTimeString;
};

export type PlannerSnapshot = {
  today: ISODateString;
  tasks: PlannerTask[];
  planSlots: PlannerSlot[];
  blackoutWindows: PlannerBlackout[];
  goals: PlannerGoal[];
  inbox?: PlannerInboxItem[];
};

export type PlannerOptions = {
  lookaheadDays?: number;
  slotMinutes?: number;
  dailyCapacityHours?: number;
  maxTaskTypesPerDay?: number;
};

export type PlannerWarningCode = "outside_lookahead" | "capacity_shortfall" | "locked_overflow";

export type PlannerWarning = {
  code: PlannerWarningCode;
  message: string;
  details?: Record<string, unknown>;
};

export type PlannerDraft = {
  frozenSlots: PlannerSlot[];
  proposedSlots: PlannerSlot[];
  unassignedTaskIds: string[];
  warnings: PlannerWarning[];
  appliedOptions: Required<
    Pick<PlannerOptions, "lookaheadDays" | "slotMinutes" | "dailyCapacityHours" | "maxTaskTypesPerDay">
  >;
};
