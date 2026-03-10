// @ts-check

import { PrismaClient } from '@prisma/client';
import path from 'node:path';

const DEFAULT_DB_URL = `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`;

/**
 * Normalize DATABASE_URL so relative SQLite paths become absolute.
 * @param {string | undefined} url
 * @returns {string}
 */
const resolveDatabaseUrl = (url) => {
  if (!url) {
    return DEFAULT_DB_URL;
  }

  if (url.startsWith('file:')) {
    const filePath = url.replace(/^file:/, '');

    if (!path.isAbsolute(filePath)) {
      return `file:${path.resolve(process.cwd(), filePath)}`;
    }
  }

  return url;
};

process.env.DATABASE_URL = resolveDatabaseUrl(process.env.DATABASE_URL);

/**
 * @typedef {'planned' | 'in_progress' | 'done' | 'dropped'} TaskStatus
 *
 * @typedef {Object} TaskSeed
 * @property {string} key
 * @property {string} title
 * @property {TaskStatus} status
 * @property {number} estimateMinutes
 * @property {number} priority
 * @property {number} [dueInDays]
 * @property {number} [plannedOffset]
 *
 * @typedef {Object} PlanSlotSeed
 * @property {string} taskKey
 * @property {number} dayOffset
 * @property {number} plannedMinutes
 * @property {number} [position]
 * @property {boolean} [locked]
 */

/** @type {PrismaClient} */
const prisma = new PrismaClient();

/**
 * @param {Date} date
 * @returns {Date}
 */
const startOfDay = (date) => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

/**
 * @param {Date} date
 * @param {number} days
 * @returns {Date}
 */
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

/**
 * @param {Date} date
 * @param {number} hours
 * @returns {Date}
 */
const addHours = (date, hours) => {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
};

const resetTables = async () => {
  await prisma.$transaction(async (tx) => {
    await tx.planSlot.deleteMany();
    await tx.completionLog.deleteMany();
    await tx.blackoutWindow.deleteMany();
    await tx.task.deleteMany();
  });
};

/**
 * @param {Date} baseDate
 * @returns {Promise<Record<string, import('@prisma/client').Task>>}
 */
const seedTasks = async (baseDate) => {
  /** @type {TaskSeed[]} */
  const tasks = [
    {
      key: 'roadmap',
      title: 'Plan weekly roadmap',
      status: 'in_progress',
      estimateMinutes: 180,
      priority: 2,
      dueInDays: 2,
      plannedOffset: 0,
    },
    {
      key: 'uiHardening',
      title: 'Stabilize UI interactions',
      status: 'planned',
      estimateMinutes: 240,
      priority: 1,
      dueInDays: 5,
      plannedOffset: 1,
    },
    {
      key: 'deepWork',
      title: 'Focus mode research spike',
      status: 'planned',
      estimateMinutes: 150,
      priority: 0,
      dueInDays: 7,
      plannedOffset: 2,
    },
  ];

  /** @type {Record<string, import('@prisma/client').Task>} */
  const created = {};

  for (const task of tasks) {
    created[task.key] = await prisma.task.create({
      data: {
        title: task.title,
        status: task.status,
        estimateMinutes: task.estimateMinutes,
        priority: task.priority,
        plannedDate:
          task.plannedOffset !== undefined ? addDays(baseDate, task.plannedOffset) : null,
        dueDate: task.dueInDays !== undefined ? addDays(baseDate, task.dueInDays) : null,
        locked: false,
      },
    });
  }

  return created;
};

/**
 * @param {Date} baseDate
 * @param {Record<string, import('@prisma/client').Task>} tasks
 */
const seedPlanSlots = async (baseDate, tasks) => {
  /** @type {PlanSlotSeed[]} */
  const slots = [
    { taskKey: 'roadmap', dayOffset: 0, plannedMinutes: 90, position: 0 },
    { taskKey: 'uiHardening', dayOffset: 1, plannedMinutes: 120, position: 0 },
    { taskKey: 'deepWork', dayOffset: 2, plannedMinutes: 60, position: 0 },
    { taskKey: 'uiHardening', dayOffset: 3, plannedMinutes: 90, position: 0 },
    { taskKey: 'roadmap', dayOffset: 4, plannedMinutes: 60, position: 0 },
    { taskKey: 'deepWork', dayOffset: 5, plannedMinutes: 90, position: 0 },
    { taskKey: 'uiHardening', dayOffset: 6, plannedMinutes: 60, position: 0 },
  ];

  const data = slots.map((slot) => ({
    taskId: tasks[slot.taskKey].id,
    slotDate: addDays(baseDate, slot.dayOffset),
    plannedMinutes: slot.plannedMinutes,
    position: slot.position ?? 0,
    locked: slot.locked ?? false,
  }));

  await prisma.planSlot.createMany({ data });
};

/**
 * @param {Date} baseDate
 * @param {import('@prisma/client').Task} task
 */
const seedCompletionLog = async (baseDate, task) => {
  await prisma.completionLog.create({
    data: {
      taskId: task.id,
      loggedAt: addHours(addDays(baseDate, -1), 10),
      minutesSpent: 45,
      note: 'Kickoff and outline for the roadmap.',
    },
  });
};

/**
 * @param {Date} baseDate
 */
const seedBlackout = async (baseDate) => {
  const blackoutStart = addHours(addDays(baseDate, 2), 13);

  await prisma.blackoutWindow.create({
    data: {
      start: blackoutStart,
      end: addHours(blackoutStart, 4),
      reason: 'Team offsite (capacity blocked).',
    },
  });
};

const main = async () => {
  const today = startOfDay(new Date());

  await resetTables();

  const tasks = await seedTasks(today);
  await seedPlanSlots(today, tasks);
  await seedCompletionLog(today, tasks.roadmap);
  await seedBlackout(today);
};

main()
  .then(() => {
    console.info('Database seeded with demo planning data.');
  })
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
