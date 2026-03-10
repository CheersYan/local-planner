# Project purpose
A local-only personal planning web app with AI chat.

# Core rules
- The database is the source of truth.
- AI only converts user messages into structured planner commands.
- Never store OpenAI API keys in client-side code or browser localStorage.
- All OpenAI calls must happen on the server.
- The planner must be deterministic and testable.
- Replanning only affects today and future days, never rewrite past logs.
- Keep diffs small. Do only the requested task.
- Run lint, typecheck, and tests before finishing a task.
- Update README when env vars or scripts change.

# Stack
- Next.js
- TypeScript strict mode
- Tailwind + shadcn/ui
- Prisma + SQLite
- Zod
- Vitest + Playwright

# Docs & UI
- 规格文档：`docs/spec.md`（用例、数据模型草案、重排规则、AI 职责边界）。
- 首页方向：三栏布局——左侧 AI 聊天/常用指令/操作预览，中间 Today + 本周/未来 7–14 天计划，右侧任务状态、完成记录、blackout、容量/重排提醒；浅灰或深色底、渐变和大圆角卡片。
