# 规格：nuwax-conversation-renderer-v2

- 对应 intent：plans/20260830-nuwax-conversation-renderer-v2-intent.md
- 状态：技术评审通过（决策在 codex 会话 01a04e2c Plan Mode 收敛，交接文本即完整规格）

## 需求基线

见 intent。增量补充一点实施口径：普通会话 = `pages/Chat` 主会话面与 `/mock-chat` 验收页（同一 `UnifiedChatSession` 链）。本期这两处接入 V2 选择器；`PreviewAndDebug`、`ConversationAgent` 面板与 AppDev 不传新 prop，天然保持 V1（零回归），后续可按同一 prop 接入。

## 方案设计

### 进程与边界

- 只动 nuwax 子模块前端；无 IPC、无后端协议、无 Electron 侧改动。
- 渲染选择边界：`ChatContentArea` 新增可选 prop `messageRenderer?: 'v1' | 'v2'`（默认 `'v1'`）。
  - `renderMessageItem` 存在 → 恒走原逻辑（AppDev/预览扩展点不受影响）。
  - `messageRenderer === 'v2'` → 渲染全新 `ConversationRendererV2`（含异常回退）。
  - 其余 → 现有逐消息 `ChatView` 路径逐字节不变。
- `UnifiedChatSession` 透传该 prop；`pages/Chat` 与 `src/examples/MockChat` 从偏好解析 hook 取值传入。

### 数据与状态（核心契约）

**投影纯函数层** `nuwax/src/features/conversation/presentation-v2/`（无 React 依赖，双数据线共用）：

- `MessageInfo[] → ConversationPresentationV2[]`，逐轮输出：
  - 轮次分组：优先 `requestId` 相同的连续消息归组；`requestId` 缺失（乐观消息/中断轮/历史消息常态）回退按 USER 消息边界切分。半轮（历史前插、resume 占位）与整轮同一函数处理。
  - 每轮：USER 消息原样保留为独立输入项（不造摘要）；ASSISTANT 消息 text 用容错词法解析器切分为有序段：`markdown-custom-think` 块、`markdown-custom-process` 属性标签（executeId/type/status/name）、正文段、无法识别的残留 → `unknown` 节点；任何畸形输入产出 `unknown` 节点而不抛异常。
  - 工具详情合并：以 `executeId`（缺失时用 `toolCallId` 关联）把消息内 `processingList`、终态 `finalResult.componentExecuteResults`（`reconcileFinalMessageState` 同款合并规则：终态覆盖流式、残余 EXECUTING→FAILED、缺失补齐）连到节点；渲染期再从全局 chat model `getProcessingById` 兜底。
  - 节点类型 `ConversationProcessNode.kind ∈ { reasoning, context, narration, tool, subagent, plan, completed-interaction, unknown }`：think→reasoning；SYSTEM→context；工具正文间中间说明→narration；`type=SubAgent`→subagent；`type=Plan`→plan；`type=Event` 丢弃（OpenUI render 例外，按 tool 处理）；已完成的 ask/权限交互（toolCallId 可关联则并入对应工具节点标记，否则独立节点）→completed-interaction。
  - **最终回答** `ConversationFinalAnswer` 选择顺序：① 最后一条非空 `finalResult.outputText`（剥离内嵌 process/think 标签后展示）② 终态最后一条有效 CHAT/ANSWER 正文段 ③ 无正文则只显示停止/错误状态，禁止把工具输出冒充回答。禁读 `ConversationInfo.summary`（长期记忆）。
  - 指标：工具数=非 Plan/Event 的稳定 executeId 去重计数；消息数=reasoning+context+narration+completed-interaction（不含 USER/最终回答/tool/subagent/plan/unknown）；耗时优先 `finalResult.startTime/endTime`，其次 processing 最早开始与最晚结束，运行态每秒跳动、终态冻结；缺失指标单独省略，零工具时以「执行过程」开头。

**渲染偏好** `ConversationRenderPreferencesV2`：预设 `focused | balanced | detailed`（balanced 为默认）+ 逐类 `hidden | summary | expanded` 高级覆盖；失败节点即使配置 hidden 至少恢复错误摘要；hidden 节点不占轨迹行，但底部保留「另有 N 项已隐藏」入口可临时查看。

**配置解析优先级**：URL `conversationRenderer=v1|v2` > 会话覆盖（可清除）> 全局偏好 > 构建默认 V2。独立 localStorage 键（`conversation_renderer_v2`、`conversation_renderer_v2_preset`、`conversation_renderer_v2_node_overrides`、`conversation_renderer_v2_session_overrides`），不迁移不复用 `conversation_density`；V1 密度三档行为原样。事件广播与即时生效模式照抄 `conversationDensity.ts`。

**手动折叠状态**：组件本地（不持久化），按 `conversationId+turnKey` 键控；用户点击后固定，流式增量与 FINAL_RESULT 均不得重置；未手动干预时跟随默认（运行轮外层展开、终态 focused/balanced 收起、detailed 展开）。

**异常回退**：`ConversationRendererV2` 外包 ErrorBoundary + 投影 try/catch 双保险；任一异常 → console 诊断 + 整份会话回退 V1 ChatView 列表，禁止白屏或半套混渲。

### 引擎与平台矩阵

| 行为点 | legacy 数据线 | runtime 数据线 | 桌面深/浅色 | 移动端构建 |
|---|---|---|---|---|
| V1 渲染 | 原样 | 原样 | 原样 | 原样（不传 prop 即 V1） |
| V2 渲染 | 投影可用 | 投影可用 | 适配（复用 token/深色类） | 本期不接入口，代码可达但不激活 |

双线 × 双渲染 = 4 组合全部被单测（投影对两线同构 MessageInfo 断言一致）与 e2e（`conversationRuntime=0/1` × `conversationRenderer=v1/v2`）覆盖。

## 渲染与视觉

- V2 为克制工具型时间线：外层一条轻量横向 disclosure 头「`N 次工具调用 · M 条消息 · 已工作 T`」（无工具时「执行过程」开头，缺失指标省略），非厚重卡片。
- 展开后按真实顺序单行节点：状态图标+标题+省略摘要常显；点击节点展开受限高度详情（`min(360px, 45vh)` 内部滚动）。工具详情复用现有 `MarkdownCustomProcess`（保 Diff/终端/Plan/OpenUI/文件操作能力），不重做工具卡。
- USER 气泡复用 `ChatView` 原样渲染（视觉零差异）；最终回答独立常显，走 `MarkdownRenderer` 正常 Markdown；回答操作栏（复制/调试）只归属最终回答，复制内容不含隐藏过程。
- 待回答审批/提问卡继续由 `AgentInterventionChatLayer` dock 独立置顶（不进轨迹）；完成后投影为 completed-interaction 节点。
- 运行态：低对比扫光/状态点 + `prefers-reduced-motion` 支持；活动节点只显示单行动态摘要。
- 可访问性：外层与节点均整行点击 + Enter/Space + `aria-expanded`/`aria-controls` + 焦点样式。

## 异常与失败场景

- 畸形标签/属性缺失 → unknown 节点，不中断整轮。
- 投影/渲染未捕获异常 → 整份会话回退 V1 + 诊断日志。
- localStorage 不可用 → 回落构建默认 V2，UI 可用性不受影响。
- 半轮/分页/resume 占位 → 与整轮同一投影，边界消息不重复不丢失。
- 迟到 FINAL_RESULT / 终态补齐 → 只补数据，不重置手动折叠状态。
- 空轮（只有思考无工具）→ 「执行过程」头 + 消息计数照常。

## 测试计划

- 纯函数（`tests/conversationPresentationV2*.test.ts`）：轮次边界（requestId/USER 回退）、分页半轮、标签解析容错与顺序、工具去重、缺失 ID、Plan/Event 排除、最终回答三级选择、指标/耗时、投影异常安全、偏好解析（预设/覆盖/失败节点恢复/隐藏计数）。
- 组件（`ConversationRendererV2` + `ChatContentArea` 选择器）：两级折叠与默认态、三档预设、高级覆盖、隐藏恢复入口、运行摘要、终态默认、手动状态跨流式保持、键盘/ARIA/焦点、长详情滚动、待回答卡独立、完成交互归档、回答操作栏与复制范围、V2 异常回退 V1、renderMessageItem 优先。
- 双线：`tests/conversationRendererDualLine.test.ts` 用 trace harness 产出的两线 MessageInfo 驱动投影 + 组件四组合断言；现有 V1 测试套件零修改通过。
- e2e：`/mock-chat` 增加 `conversationRenderer` URL 参数与 V2 断言集，场景矩阵覆盖长任务/多轮 reasoning/连续工具/子智能体/审批提问/错误/停止/迟到 FINAL_RESULT/历史分页。
- 回归：`npm run test:conversation`、`npm run e2e:mock-chat`、`npm run build:prod`、父仓 `npm run test:electron`。已知基线：MarkdownRenderer 3 个既存失败（2 LaTeX + 1 标签编码），非本需求回归。

## i18n 与文案

新增 `PC.Components.ConversationRendererV2.*` 键（轨迹头/指标/节点标题/隐藏恢复/设置入口/预设名等），落 `src/locales/i18n/zh-CN` 与 `en-US`（其余语言经 en/zh 兜底链生效）。

## 已否决的备选方案

- 继续在 ChatView/MarkdownRenderer 内做折叠增强——已被上一版 revert 证伪：文本协议重解析无法支撑结构化控制，且污染旧链。
- V2 直接改造 `renderMessageItem` 回调——该口是单消息级，V2 需要整轮视角，粒度不合。
- 等后端下发结构化 blocks 再做——本期用适配层即可达成目标，后端就绪后只换 adapter。
- requestId 作为唯一轮次键——乐观消息/中断轮/历史消息常态缺失，必须 USER 边界兜底。
- 复用 `conversation_density` 存储——语义不同（密度≠渲染器版本+类别可见性），迁移会破坏 V1 行为。
