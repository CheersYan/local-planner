# 本地规划器规格（草案）

## 目标
- 本地优先的个人计划器，数据库是唯一真相，所有决策可复现、可测试。
- AI 仅把自然语言转成结构化指令，规划与存储在本地服务完成。
- 只重排今天及未来的安排，历史日志只追加、不覆盖。

## 核心用例（5）
1. 我跟他说我接下来多少天想要做多少任务，他会记录并显示在网站上，并帮我规划每天的任务。
2. 我跟他说我今天完成了什么，他会记录也显示在页面上。
3. 我跟他说什么什么任务时间比较长估计得缩短工作量。
4. 我跟他说几号到几号干不了，会重新规划每天的任务。
5. 我跟他说我最近短期内有个新的任务，会帮我重新规划最近的任务。

## 非目标
- 不做多人协作、账号系统或云同步，默认单用户本地数据。
- 不自动执行任务或发通知，专注规划与记录。
- 不在客户端保存或暴露任何 API key；不将计划数据发送到外部服务。
- 不修改过去日期的日志或完成记录。
- 不引入概率性或难以测试的 AI 规划逻辑，保持确定性。

## 数据模型草案（SQLite / Prisma）
- `Task`：`id`、`title`、`status`(`planned|in_progress|done|dropped`)、`estimateMinutes`、`actualMinutes?`、`dueDate?`、`plannedDate?`、`priority`、`locked`(手动固定)、`createdAt/updatedAt`。
- `PlanDay`：`id`、`date`、`capacityMinutes`（每日可用时间，默认 480）、`loadMinutes`（已分配总时长）、`createdAt/updatedAt`。
- `PlanDayTask`：`id`、`planDayId`、`taskId`、`order`、`plannedMinutes`，保证同一天内有序并可调整。
- `GoalWindow`：`id`、`startDate`、`endDate`、`targetTaskCount` 或 `targetMinutes`，对应用例 1。
- `Blackout`：`id`、`start`、`end`、`reason`，用于不可用时段（用例 4）。
- `CompletionLog`：`id`、`taskId`、`loggedAt`、`minutesSpent?`、`note`（用例 2）。
- `CommandInbox`：`id`、`type`、`payload`(JSON)、`messageId?`、`status`(`pending|applied|rejected`)、`createdAt`，AI 解析结果进入此表，供可测试的调度器消费。
- 派生/视图：每日负载、容量缺口、未排期任务列表，用于告警与 UI 展示。

## 重排规则（仅影响今天及未来）
1. 触发：新增任务、调整估时、设置 blackout、提交目标窗口、用户请求“重新排期”。
2. 冻结过去：`date < today` 的任务与日志保持不变；已完成任务不移动。
3. 计算每日容量：`capacityMinutes - blackout` 得到可用分钟数，黑名单日容量可为 0。
4. 保留固定：`locked` 的任务保持在原日期与顺序，除非容量为负才提示无法满足。
5. 重新分配：
   - 优先级排序（dueDate、priority、新增时间）；
   - 在未来 7–14 天滚动窗口内填充，先补足当前周，再向后推；
   - 单个任务可拆分到连续日期，拆分粒度默认 60 分钟；
   - 如果某日超载，向后顺延最近的可用日。
6. 报警与提示：若窗口内容量不足，保留未分配队列并产生“容量不足”提醒； blackout 造成的移位需生成“重排提醒”。

## AI 职责边界
- AI 只做命令解析，不直接写数据库、不运行排期算法。
- 典型命令类型（写入 `CommandInbox`）：
  - `set_goal`: {`days`, `targetTasks`|`targetMinutes`}（用例 1）。
  - `log_done`: {`taskId`|`title`, `minutesSpent?`, `note?`}（用例 2）。
  - `tune_estimate`: {`taskId`, `estimateMinutes`}（用例 3）。
  - `set_blackout`: {`start`, `end`, `reason`}（用例 4）。
  - `add_task`: {`title`, `estimateMinutes`, `dueDate?`, `priority?`}（用例 5）。
- 排期服务读取命令并以确定性逻辑更新 `Task` / `PlanDay` 等表，可在测试中重放命令流验证结果。

## 界面建议（首页三栏）
- 左：AI 聊天区，含对话输入、常用指令 chips、“识别到的操作”预览卡。
- 中：计划主视图，展示 Today 卡片、本周任务条带或日历、未来 7–14 天分配表。
- 右：状态与异常，含任务列表、完成记录、blackout 时间段、重排提醒/容量不足警告。
- 风格：浅灰或深色底，柔和渐变背景，大圆角卡片、轻阴影，少量动效，信息密度中等（不过度堆砌）。

