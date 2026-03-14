-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "estimateMinutes" INTEGER NOT NULL,
    "remainingMinutes" INTEGER,
    "actualMinutes" INTEGER,
    "dueDate" DATETIME,
    "plannedDate" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "parentTaskId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plan_slot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "slotDate" DATETIME NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "plan_slot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "completion_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "loggedAt" DATETIME NOT NULL,
    "minutesSpent" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "completion_log_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "blackout_window" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "chat_audit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "messageId" TEXT,
    "message" TEXT NOT NULL,
    "commandType" TEXT,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "task_status_idx" ON "task"("status");

-- CreateIndex
CREATE INDEX "task_plannedDate_idx" ON "task"("plannedDate");

-- CreateIndex
CREATE INDEX "task_dueDate_idx" ON "task"("dueDate");

-- CreateIndex
CREATE INDEX "task_parentTaskId_idx" ON "task"("parentTaskId");

-- CreateIndex
CREATE INDEX "task_deletedAt_idx" ON "task"("deletedAt");

-- CreateIndex
CREATE INDEX "plan_slot_taskId_idx" ON "plan_slot"("taskId");

-- CreateIndex
CREATE INDEX "plan_slot_slotDate_idx" ON "plan_slot"("slotDate");

-- CreateIndex
CREATE UNIQUE INDEX "plan_slot_slotDate_position_key" ON "plan_slot"("slotDate", "position");

-- CreateIndex
CREATE INDEX "completion_log_taskId_idx" ON "completion_log"("taskId");

-- CreateIndex
CREATE INDEX "completion_log_loggedAt_idx" ON "completion_log"("loggedAt");

-- CreateIndex
CREATE INDEX "blackout_window_start_end_idx" ON "blackout_window"("start", "end");

-- CreateIndex
CREATE INDEX "chat_audit_messageId_idx" ON "chat_audit"("messageId");

-- CreateIndex
CREATE INDEX "chat_audit_createdAt_idx" ON "chat_audit"("createdAt");

-- CreateIndex
CREATE INDEX "chat_audit_status_idx" ON "chat_audit"("status");
