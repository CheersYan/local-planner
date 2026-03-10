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