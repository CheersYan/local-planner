Local Planner
=============

Local-only personal planning web app. AI 只负责把对话转成结构化指令，排期逻辑在本地、可重放、可测试。

Documentation
-------------
- 项目规格（用例、数据模型、重排规则、界面方向）：`docs/spec.md`。
- 团队规则与栈：`AGENTS.md`。

Getting Started
---------------
- Install dependencies (pnpm only): `pnpm install`
- Run the dev server: `pnpm dev` then open http://localhost:3000

Development
-----------
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- 数据库存本地 SQLite，数据库是唯一真相；不在客户端存储 API key。

Design Snapshot
---------------
首页建议三栏：左侧 AI 聊天与“识别到的操作”预览，中间 Today/本周/未来 7–14 天计划视图，右侧状态与异常（任务列表、完成记录、blackout、容量/重排提醒）；浅灰或深色底、大圆角卡片、轻渐变与柔和阴影。 
