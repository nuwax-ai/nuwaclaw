# 规格：nuwax-turn-process-collapse

- 对应 intent：`plans/20260830-nuwax-turn-process-collapse-intent.md`
- 状态：技术评审通过（2026-08-30）

## 需求基线

完整目标与边界见对应 intent。本期把普通会话的一轮 USER 请求及其后续助手输出投影为稳定的轮次展示：USER 输入保持独立，助手过程进入一个 disclosure，最终总结独立常显。

## 方案设计

### 进程与边界

- 全部改动位于 `nuwax` 渲染进程；不新增主进程逻辑、IPC handler，也不改变 context isolation。
- 在普通会话消息列表进入 `ChatView` 前建立轮次投影。优先使用 `requestId` 关联，同一 USER 后缺少 `requestId` 的连续非 USER 消息按位置回退归组；下一个 USER 开启新轮次。
- 自定义 `renderMessageItem` 路径保持现状，避免改变调用方自定义渲染契约；默认普通会话采用轮次展示。
- AppDev 的 `ChatArea` 与其独立过程组组件不改。

### 数据与状态

- 新增内部 `ConversationTurnPresentation`：稳定轮次 key、USER 消息、过程条目、最终 summary、终态/运行态、统计指标。
- 新增 `ProcessSummaryMetrics`：`toolCallCount`、`messageCount`、可选 `elapsedMs`。
- 最终 summary 首选非空 `finalResult.outputText`；否则使用终态中最后一条有效 CHAT/ANSWER 正文。会话长期记忆 summary 永不参与。
- 工具调用按稳定 `executeId/toolCallId` 去重。Plugin、Workflow、MCP、SubAgent、ToolCall 等实际调用计入；Plan 与 Event 不计。
- 非工具消息数按逻辑条目统计思考块、SYSTEM/上下文、已完成提问和中间助手说明；USER、最终 summary、工具调用不计。
- 耗时优先使用整轮 final result 起止时间，其次使用 processing 最早/最晚有效时间；运行中用当前时间更新，无有效时间则省略。
- disclosure 展开态为组件本地状态并绑定稳定轮次 key。流式内容增长不得重挂组件或覆盖用户手动选择。
- 不新增 Redux/SQLite/localStorage 数据；继续读取现有 conversation density 偏好。

### 展示与交互

- header 有工具时显示 `N 次工具调用`，无工具时显示 `执行过程`；随后按存在性追加 `M 条消息`、`已工作 T`。
- normal：活动过程默认展开，终态默认收起；compact：活动与终态默认收起；detailed：默认展开。三档均允许手动切换。
- pending 审批/提问卡保持在 disclosure 外；处理完成后的历史条目才进入过程区。
- 最终 summary 在 disclosure 下方使用现有 Markdown 能力展示代码、链接、表格与 task-result，不增加固定标题或卡片。
- header 整行可点击，并支持 Enter/Space、`aria-expanded`、`aria-controls`、可见焦点与 reduced-motion。

### 引擎与平台矩阵

| 行为点 | claude-code | nuwaxcode | Win | macOS | Linux |
|---|---|---|---|---|---|
| 普通会话轮次折叠 | 相同前端投影 | 相同前端投影 | Chromium 一致 | Chromium 一致 | Chromium 一致 |
| 工具计数 | 按归一化稳定调用 ID | 按归一化稳定调用 ID | 无平台差异 | 无平台差异 | 无平台差异 |
| 键盘与动画 | 相同 | 相同 | Enter/Space | Enter/Space | Enter/Space |

## 异常与失败场景

- 没有工具但有过程：显示“执行过程”，可追加消息数和耗时。
- 没有最终正文：只展示过程 disclosure 与既有错误/停止状态，不生成虚假 summary。
- 时间缺失、倒序或非有限值：隐藏耗时，不显示 `0` 或负数。
- 重复/更新式工具事件：同一稳定 ID 只计一次，展示保留最新状态。
- 分页从半轮开始：只归组当前已加载消息；加载更早消息后稳定 key 和滚动锚点不应抖动。
- pending 人机交互：保持 disclosure 外可操作，避免折叠导致死锁。

## 测试计划

- 纯函数：轮次边界、requestId/fallback、分页半轮、summary 选择、工具去重、消息计数、耗时。
- 组件：三档密度、手动状态保持、终态 summary 常显、键盘/ARIA、零工具、错误/停止、pending 交互。
- Mock E2E：扩展 `TERMINAL_COLLAPSE` / `COLLAPSE_SHOWCASE`，同时覆盖 legacy/runtime。
- 回归：受影响 Vitest、`npm run test:conversation`、`npm run e2e:mock-chat`、nuwax build、父仓 Electron 测试。

## i18n 与文案

- 在现有 zh-CN、zh-TW、zh-HK、en-US、ja-JP locale 中补齐“次工具调用”“条消息”“已工作”及耗时格式所需 key。
- 折叠/展开依赖 aria label 时同样使用 locale key，不硬编码中文。

## 已否决的备选方案

- 只折叠连续工具调用：无法解决思考与中间助手消息造成的长页面。
- 仅在单个 `ChatView` 内聚合：无法覆盖同一任务跨多个 `MessageInfo` 的真实协议形态。
- 直接使用 `ConversationInfo.summary`：它是长期记忆会话摘要，可能跨轮且语义错误。
- 折叠 pending 审批卡：会隐藏必须完成的人机交互并阻塞任务。
