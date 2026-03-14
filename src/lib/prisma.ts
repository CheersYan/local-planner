import { PrismaClient } from '@prisma/client';

export type TaskStatus = 'active' | 'paused' | 'completed' | 'archived';
export type CommandStatus = 'pending' | 'applied' | 'rejected';
export type CommandType =
  | 'set_goal'
  | 'log_done'
  | 'tune_estimate'
  | 'set_blackout'
  | 'add_task';

// Re-use Prisma client across hot reloads in dev to avoid opening too many connections.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
