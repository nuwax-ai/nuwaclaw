# 实施计划：nuwax-conversation-renderer-v2

- 对应 spec：specs/nuwax-conversation-renderer-v2.md
- 状态：已接受（完整计划文本由用户自 codex 会话 01a04e2c 交接，不得缩减范围）
- 实施者：zcode；分支：父仓 `codex/nuwax-conversation-renderer-v2` / 子模块 `feat/conversation-renderer-v2`

## 改动文件清单（全部在 nuwax/ 子模块，另有父仓工件三份）

| # | 文件 | 动作 | 说明 |
|---|---|---|---|
| 1 | src/features/conversation/presentation-v2/types.ts | 增 | ConversationPresentationV2 / ConversationProcessNode / ConversationFinalAnswer / ConversationRenderPreferencesV2 / NodePresentationMode |
| 2 | src/features/conversation/presentation-v2/parseMessageSegments.ts | 增 | 容错词法解析：text → 有序段（think/process/正文/unknown），畸形不抛异常 |
| 3 | src/features/conversation/presentation-v2/projectConversation.ts | 增 | MessageInfo[] → ConversationPresentationV2[]：轮次分组、节点分类、详情合并、最终回答三级选择、指标 |
| 4 | src/features/conversation/presentation-v2/renderPreferences.ts | 增 | 三档预设表、逐类覆盖解析、失败节点最低可见性、隐藏计数 |
| 5 | src/features/conversation/presentation-v2/index.ts | 增 | 纯函数层出口 |
| 6 | src/features/conversation/presentation-v2/react/ConversationRendererV2.tsx | 增 | V2 消息列表渲染器（含 ErrorBoundary 回退 V1、投影 try/catch） |
| 7 | src/features/conversation/presentation-v2/react/WorkTraceDisclosure.tsx | 增 | 外层轨迹 disclosure（header 指标、键盘/ARIA、运行态动效） |
| 8 | src/features/conversation/presentation-v2/react/ProcessNodeRow.tsx | 增 | 单行节点 + 受限高度详情（复用 MarkdownCustomProcess） |
| 9 | src/features/conversation/presentation-v2/react/FinalAnswerBlock.tsx | 增 | 最终回答常显 + 操作栏（复制只含回答） |
| 10 | src/features/conversation/presentation-v2/react/*.less | 增 | 时间线样式（token/深色适配、reduced-motion、min(360px,45vh) 详情滚动） |
| 11 | src/features/conversation/presentation-v2/react/index.ts | 增 | React 层出口（页面经组件 prop 消费，不违反 eslint 页面层约定） |
| 12 | src/utils/conversationRendererPreference.ts | 增 | flag+偏好存取（URL>会话覆盖>全局>默认 v2；预设/逐类覆盖/会话覆盖清除；CustomEvent 广播） |
| 13 | src/hooks/useConversationRendererPreference.ts | 增 | 偏好 hook（含 conversationId 会话覆盖态） |
| 14 | src/components/business-component/UnifiedChatSession/components/ChatContentArea/index.tsx | 改 | 新增可选 prop `messageRenderer`（默认 v1）；v2 且无 renderMessageItem → ConversationRendererV2 |
| 15 | src/components/business-component/UnifiedChatSession/types.ts + index.tsx | 改 | 透传 messageRenderer |
| 16 | src/pages/Chat/index.tsx | 改 | 从 hook 解析 effectiveRenderer 传入 |
| 17 | src/examples/MockChat/index.tsx | 改 | 支持 URL `conversationRenderer=v1|v2` 并透传；V2 断言集 |
| 18 | src/components/business-component/UnifiedChatSession/components/ChatInputHomeIndependent/index.tsx | 改 | 「会话显示」入口（V1/V2、预设、高级覆盖、会话覆盖清除） |
| 19 | src/locales/i18n/zh-CN/*、en-US/* | 改 | PC.Components.ConversationRendererV2.* 与 ChatInputHome 会话显示键 |
| 20 | tests/conversationPresentationV2.test.ts | 增 | 投影纯函数合同 |
| 21 | tests/conversationRendererPreference.test.ts | 增 | 偏好解析合同 |
| 22 | tests/conversationRendererV2Component.test.tsx | 增 | 组件行为（折叠/预设/键盘/回退/复制范围） |
| 23 | tests/conversationRendererDualLine.test.ts(x) | 增 | legacy/runtime 数据 × V1/V2 四组合 |
| 24 | tests/unifiedChatSession.rendererSelection.test.tsx | 增 | ChatContentArea 选择器（v1 默认零变化、renderMessageItem 优先） |
| 25 | mock/conversationScenarios.ts | 改 | 新增 V2 展示场景（子智能体/多轮 reasoning 长任务） |
| 26 | scripts/e2e/mock-chat-acceptance.mjs | 改 | E2E_RENDERER=v1|v2|both 维度 + V2 断言/交互用例 |
| 27 | docs/conversation/renderer-v2.md | 增 | V2 渲染器设计/配置/回退说明 |

## 实施顺序

1. 纯函数层（1-5）+ 纯函数测试（20、21）——先行可测。
2. React 层（6-11）+ 组件测试（22）。
3. 接线（12-18）+ i18n（19）+ 选择器/四组合测试（23、24）。
4. mock/e2e 扩展（25、26）。
5. 全量验证：`npm run test:conversation` → `npm run e2e:mock-chat` → `npm run build:prod` → 父仓 `npm run test:electron` → 桌面手工验收。
6. 文档（27）、dist 重建提交、父仓 pin bump。

## 证明成立的测试

见 spec「测试计划」。重点门槛：现有 V1 测试零修改通过；四组合矩阵；V2 异常回退不白屏。

## 风险与回退

| 风险 | 缓解 | 回退方式 |
|---|---|---|
| V2 默认开启造成线上问题 | URL/会话/全局三级即时退回 V1；ErrorBoundary 兜底 | 设置「会话显示」切 V1 或 `?conversationRenderer=v1` |
| 投影在畸形数据抛异常 | 词法解析器容错 + 投影 try/catch + ErrorBoundary 双保险 | 整份会话自动回退 V1 |
| 手动折叠被流式重置 | 展开态按 turnKey 固定于组件本地 map | — |
| e2e ego-browser 运行器无输出（上轮已知） | 记录边界不算通过；以 Vitest 四组合补强 | 报告中明示未验收项 |
| 现有 UnifiedChatSession 测试回归 | messageRenderer 默认 v1，未传即原路径 | 组件级开关，零扩散 |

## 偏离记录

（实现中偏离原计划的，逐条补记：原因 + 与哪个 commit 同步更新。）

1. **验收返工（codex 验收 P1/P2，子模块返工 commit 见 gitlink）**：
   - P1 最终回答重复入轨迹：`finalResult.outputText` 存在时补做「与末段正文同源判定」（归一化后任一方向包含），同源段不再生成 narration——原实现直接置空 answerRef 导致最终结论在过程说明与回答区双现。
   - P1 最终回答角色泄漏：回答候选收紧为 ASSISTANT × CHAT/ANSWER（缺省视为 CHAT）；SYSTEM/FUNCTION 消息只产 context 节点并提前返回，不再进入段解析与回答扫描。
   - P2 工具终态合并：`collectProcessingByKey` 改为三层合并（componentExecutedList 基底 → processingList 覆盖 → finalResult.componentExecuteResults 终态覆盖/补齐），finalResult 在场时残余 EXECUTING 判 FAILED（对齐 reconcileFinalMessageState 规则）——原实现仅在 processingList 全空时读历史列表。
   - P2 无障碍与加载态：装饰图标（chevron/类别/状态/运行点）补 aria-hidden；高级配置逐类 Select 用 label 包裹 + aria-label；三个 Segmented 补 aria-label；V2 懒加载 Suspense fallback 由 null 改为 role="status" 加载占位。
   - 测试：新增 10 个反例用例（去重/角色过滤/终态合并/无障碍），修正 dual-line 中固化旧行为的断言；test:conversation 392/392 全绿。

2. **评审加固（code-reviewer 二轮，子模块 58c09b2cf + dist f36cd068d）**：
   - P1：ChatContentArea 增加本地 `V2RendererLoadBoundary`——懒加载 chunk 拉取失败（发版后旧 hash/弱网）时 V2 内部 ErrorBoundary 尚未加载、异常会冒泡卸载整棵 React 树；本地 boundary 以 V1 ChatView 列表为 fallback，补齐「禁止白屏」规格的最后一层（新增 chunk 失败回退测试）。
   - 边界：终态/状态参考消息（terminalStatus/RunOver/操作栏）改取最后一条 ASSISTANT 角色消息，轮末跟随 SYSTEM 不再遮蔽真实终态；运行态轮末瞬时跟随 SYSTEM 时实时回答区回退扫描候选正文段；工具计数按 executeId 字段去重 + 轨迹节点 React key 加序号防撞。
   - test:conversation 394/394 全绿。
