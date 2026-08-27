# ACP Plan Mode 接入方案（代码事实版）

> 状态：已实施（2026-08-26 ~ 2026-08-27）。
> 本文以**当前代码为事实依据**梳理全链路接入方案，并逐项对照 ACP 官方规范（stable v1 schema + 规范文档 + RFD 草案）给出合规结论。
> 涉及仓库：`nuwaclaw`（本文所在仓库，含 nuwax 子模块）、`nuwa-cli`、`nuwaxcode`、`claude-code-acp-ts`（上游零改动）、`deepagents-dev-templates/packages/deepagents-flow-ts`、`codex-acp-ts`；`agent-platform` 云后端零改动；`rcoder`（云电脑）为未来接入方，见 §12。

---

## 1. 端到端数据流

```
nuwax UI (webview)                    nuwax 子模块
  AgentMode 三档 plan/ask/yolo ──→ TryReqDto.agentMode（String）
                                        │
                              agent-platform（零改动）
                                ChatApplicationServiceImpl#L491
                                agentContext.setAgentMode(tryReqDto.getAgentMode())
                                        │
                                SandboxAgentClient#L1022 等
                                .agent_mode(agentContext.getAgentMode())
                                        │  HTTP POST /computer/chat
                 ┌──────────────────────┴──────────────────────┐
        nuwaclaw Electron 主进程                        nuwa-cli serve/gateway
        crates/agent-electron-client                    src/core/serve/*
                 │                                              │
        逐 chat 同步（AcpEngine.chat）                逐 prompt 同步（sessionHub 队列循环）
                 │                                              │
                 └──────────────┬───────────────────────────────┘
                                │ 共享语义：agent-kit syncBusinessModeToEngine
                                │ 下发 session/set_mode {sessionId, modeId:"plan"}
                                │ （Method-not-found → set_config_option("mode") fallback）
                                ▼
                    ACP Agent（四引擎，modeId 统一为 "plan"）
                    claude-code-acp-ts / nuwaxcode / deepagents-flow-ts / codex-acp-ts
                                │
                    ┌───────────┼───────────────────────────────┐
                    ▼           ▼                               ▼
        sessionUpdate:"plan"  request_permission        current_mode_update
        （全量 PlanEntry）    kind=switch_mode           {currentModeId}
                    │        （ExitPlanMode/plan_exit）    │
                    ▼           ▼                               ▼
        原样 SSE 透传      审批卡（AcpPermissionCard /   本地 mode 镜像去重 +
        subType=plan       nuwa-cli Console/终端）        UI 状态反馈
        → PlanProcess 卡片
```

下行（plan 的产出）：引擎 `sessionUpdate: "plan"` → 宿主以 `computer:progress` SSE 原样透传（`subType` = 原始 sessionUpdate 字符串）→ agent-platform `SandboxAgentClient.java:849` 匹配 `subType=="plan"`、`buildComponentExecutingPlan` 读取 `data.entries[].status` → 云端组件 / nuwax AppDev `PLAN` 分支渲染。

---

## 2. ACP 官方规范对照基线

### 2.1 我们依赖的 stable v1 面

| 规范点 | 官方定义 | 依据 |
|---|---|---|
| `session/set_mode` 请求 | `{sessionId, modeId}`；modeId 须为 availableModes 之一；可随时切换（idle 或 generating 均可）；响应无载荷 | v1 schema + session-modes.md |
| modes 声明（advertise） | Session Setup 期间 Agent **MAY** 返回 `SessionModeState{currentModeId, availableModes[{id, name, description?}]}`，即向客户端声明可用 session mode 列表——`set_mode` 的 modeId 合法性以此为准 | v1 schema |
| `current_mode_update` 通知 | `sessionUpdate:"current_mode_update"` + **`currentModeId`**（required） | v1 schema（`SetSessionModeRequest` 用 `modeId`、通知用 `currentModeId`，两个名字并存是规范本身的设计） |
| plan 更新 | 仅 `sessionUpdate:"plan"`；`PlanEntry{content, priority: high\|medium\|low, status: pending\|in_progress\|completed}`；Agent **MUST** 每次携带完整列表；Client **MUST** 全量替换；上报本身为 SHOULD | agent-plan.md (v1) |
| 退出 plan 模式 | 文档模式：`request_permission` + `toolCall.kind:"switch_mode"`，选项 allow_once / allow_always / reject_once 映射目标模式（描述性 pattern，非 MUST） | session-modes.md |
| modes → Config Options | 官方已声明专用 mode 方法将在未来版本移除、推荐过渡到 Session Config Options，并建议"两种都提供以向后兼容" | session-modes.md 弃用声明 |

### 2.2 实验面（RFD，按草案语义使用）

- `ClientCapabilities.plan: {}`：**不在 stable v1 schema**（stable 仅有 `_meta/auth/elicitation/fs/session/terminal`）。属 [plan-operations RFD](https://agentclientprotocol.com/rfds/plan-operations.md) 草案；SDK 0.26+ 类型注明 UNSTABLE——"Supplying `{}` means the client can receive both update types"。
- 互操作安全性已核实：SDK 0.16 的 zod `zClientCapabilities` 为普通 `z.object`（未知键 strip 不拒绝），向 nuwaxcode 声明 `plan:{}` 无害；SDK 1.3（nuwa-cli 测试 fixture）实测通过。
- RFD 门控规则：Agent 仅在 client 声明 `plan` 时才可发 `plan_update`/`plan_removed`，否则回退 legacy `plan`——我们的引擎侧只用 stable `plan`，客户端对实验变体做了超前兼容（见 §3 classifySessionUpdate）。

### 2.3 官方文档笔误与我们的防御

session-modes.md 文档页的通知**示例**写 `modeId`，与官方 v1 schema 的 `currentModeId` 矛盾；schema 与 SDK 0.16/0.26/1.3 三版一致，判定文档示例笔误。所有消费端按 **`currentModeId` 为主、`modeId` 为兜底**双读（agent-kit `classifySessionUpdate`、nuwax `useAppDevChat`、nuwaclaw `handleAcpSessionUpdate`），对两种拼写的引擎实现均不丢事件。

### 2.4 草案/v2 方向（当前不依赖）

RFD/v2 将 `plan_update` 定义为 `{plan: {id, type: "items"|"file"|"markdown", entries}}`（按 plan ID 管理）；v2 stable `plan_update` 无需能力声明、`ClientCapabilities.plan` 从 v2 移除（unstable 操作改由 `unstable_plan_operations` 门控）、旧 `sessionUpdate:"plan"` 从 v2 schema 删除。当前无任何已发布引擎按该包装形态发包（claude-code-acp-ts 1.0 亦为平铺），我们的实现以 SDK 实际平铺形态为准，v2 迁移时需补包装解析（见 §11）。

---

## 3. 共享核心：agent-kit 0.4.0（`crates/agent-kit`，单一事实来源）

结构化类型、不引 ACP SDK 运行时（peerDependencies `^0.26.0 || ^1.2.1`，一套构建同时服务两个宿主版本）。

| 模块 | 导出 | 职责 |
|---|---|---|
| `src/sessionMode.ts` | `resolveEngineModeInfo({modes, configOptions})` | mode 发现：session 响应 `modes` 字段优先（claude/deepagents/codex）；fallback 从 `mode` select config option 的 `options[].value`（含分组 `{group, options[]}` 与 `choices` 旧命名的防御）推导（nuwaxcode 路径）。返回 `{availableModes, currentModeId, source}` |
| | `resolvePlanModeId(availableModes)` | 精确 `plan` id 优先，其次含 "plan" 的 id；无则 null（宿主据此降级） |
| | `applySessionMode({sessionId, modeId, connection})` | best-effort 下发：`set_mode` 优先，失败/未实现 fallback `set_config_option("mode")`；结果三态 `applied(via)/unsupported(no_channel\|not_available)/failed(reason)` |
| | `syncBusinessModeToEngine(...)` | **业务档 ↔ 引擎档完整同步语义**（两宿主共用）：plan→下发并返回新镜像（已处于 plan 则跳过）；ask/yolo→仅当引擎仍处于 plan 时恢复初始 mode（初始即 plan 则取首个非 plan），防止 plan 跨请求泄漏 |
| | `BusinessAgentMode` / `SessionModeChannel` / `EngineModeInfo` 等类型 | ask/yolo/plan；通道结构类型（setSessionMode?/setSessionConfigOption? 可选） |
| `src/sessionUpdate.ts` | `classifySessionUpdate(update)` | 分类 plan / plan_update / plan_removed / current_mode_update（`currentModeId ?? modeId` 双读），其余 kind 透传 |
| | `normalizePlanEntries` / `normalizePlanEntry` | PlanEntry 宽松规范化：未知 status（如 nuwax legacy `failed`）→ `pending`，未知 priority → `medium`，保证线上只见合法枚举 |
| `src/clientCapabilities.ts` | `buildClientCapabilities({terminal?})` | 统一声明 `plan: {}`（+可选 terminal），两宿主 initialize 共用 |

---

## 4. nuwaclaw（Electron 主进程，`crates/agent-electron-client`）

### 4.1 类型与请求入口

- `src/shared/types/acpMode.ts`：`AcpMode = "ask" | "yolo" | "plan"`；`resolveEffectiveMode` 接受 plan（缺省 yolo，未知 fail-safe ask）。业务档与引擎档分离的契约写在文件头注释（v4）。
- 请求链：`/computer/chat` 的 `agent_config.agent_server.agent_mode`（`computerTypes.ts`）→ `AcpEngine.chat()` 内 `resolveEffectiveMode`。

### 4.2 AcpEngine（`src/main/services/engines/acp/acpEngine.ts`）

- **initialize**：`clientCapabilities: buildClientCapabilities({ terminal: true })` —— 声明 Terminal API + 实验 plan 能力。
- **mode 发现**：`applyAcpModeFromRpc(session, modes, configOptions)` 在三个 RPC 落点（`resumeAcpSession` / `loadAcpSession` / `createSession`）调用 `resolveEngineModeInfo` 缓存 `session.engineModes` 并初始化 `session.acpEngineModeId`（原来是 no-op 丢弃）。
- **本地审批**（`syncSessionModeForChat`）：agent_mode → 权限协调器；**plan 折算为 ask**（ExitPlanMode / plan_exit 类确认必须人工放行，协调器仅 `yolo` 自动放行）。
- **引擎档同步**（`syncEngineSessionModeForChat`）：`chat()` 在模型同步后调用，委托 `syncBusinessModeToEngine`；失败仅告警不阻断 prompt。
- **镜像维护**（`handleAcpSessionUpdate`）：`current_mode_update` 时以 `currentModeId ?? modeId` 更新 `session.acpEngineModeId`，供下次同步去重（引擎侧 ExitPlanMode 批准后客户端能感知）。
- **SSE 透传**：所有原始 ACP update 以 `computer:progress` 事件透传（`subType` = 原始 sessionUpdate 字符串，`data` = 原始 payload）——`plan` / `current_mode_update` 天然到达下游。

### 4.3 事件映射（`acpUpdateMapper.ts`）与类型（`acpClient.ts`）

- 新增 4 个 case：`plan`/`plan_update` → `message.part.updated {type:"plan", entries}`（经 `normalizePlanEntries`，全量替换语义）；`plan_removed` → `message.part.removed`；`current_mode_update` → `session.updated {modeId}`。
- `AcpClientSideConnection.newSession` 返回类型放宽为可携带 `modes` / `configOptions`（SDK 实际透传完整 RPC 结果）；新增本地类型 `AcpPlanUpdate` / `AcpPlanRemoved` / `AcpCurrentModeUpdate`（`currentModeId` 为主、`modeId` 防御）。

### 4.4 权限链路（复用，零新面）

`switch_mode` 类 request_permission 走既有 `handlePermissionRequest` → 决策链（MCP-ask 拒绝 → strict 守卫 → tool_approval_rules → ask/yolo）→ `acpRequestPermission` SSE → nuwax `AcpPermissionCard`。plan 会话因本地折算为 ask，必弹审批。

---

## 5. nuwax 子模块（UI，随 nuwaclaw pin bump 发布）

- **三档切换**：`AgentIntervention/types/acpIntervention.ts` `AgentMode = 'ask' | 'yolo' | 'plan'`；`useAgentInterventionLayer` 的 `isAgentMode` 接受 plan（缓存 key `nuwax_agent_mode_cache` 向后兼容）；两处输入组件（`components/ChatInputHome` 与 `UnifiedChatSession/.../ChatInputHomeIndependent`）的 `AGENT_MODE_OPTIONS` / i18n 映射加 plan 档；5 个语言包新增 `agentModePlan(Desc)` 与 `PC.Pages.AppDevChat.agentModeChanged`。
- **PLAN 数据对齐**（`hooks/useAppDevChat.ts` + `types/interfaces/appDev.ts`）：枚举新增 `PLAN_UPDATE` / `PLAN_REMOVED` / `CURRENT_MODE_UPDATE`；`plan`/`plan_update` → `upsertPlanBlock`（同 planId 全量替换）；`plan_removed` → `removePlanBlocks`；`current_mode_update` → antd toast（双读字段）。
- **markdown 块语义**（`pages/AppDev/utils/markdownProcess.ts`）：`upsertPlanBlock` 按 planId 解码替换旧 `<appdev-plan>` 块（TodoWrite 高频全量更新不再堆叠卡片）、`removePlanBlocks` 清空。
- **渲染**：`PlanProcess` 组件渲染 pending/in_progress/completed（`failed` 保留为 legacy 数据兼容，ACP 路径不再产生）。

---

## 6. nuwa-cli（`/Users/apple/workspace/nuwa-cli`，npm 工程）

- **连接层**（`src/core/acp/connection.ts`）：initialize 走 `buildClientCapabilities()`（`plan:{}`，headless 无 terminal）；`routeSessionUpdate` 经 `classifySessionUpdate` 分发新增 `onPlanUpdate({entries, removed})` / `onModeChange(modeId)` 处理器（`EngineSessionHandlers` 扩展）。
- **模式应用**（`src/core/acp/sessionMode.ts`）：本地 `applySessionMode` 保留 CLI 语义（`--mode` / `--yolo` 偏好探测 + i18n 警告），实际下发委托 agent-kit（含 config-option fallback）；`sessionModeChannelFor(ctx)` 把 `ClientContext.request` 适配为共享通道。
- **下行透传**（`src/core/serve/downstreamConfig.ts`）：`/computer/chat` 解析 `agent_config.agent_server.agent_mode` → `DownstreamSessionConfig.agentMode`（ask/yolo/plan，未知丢弃）。
- **sessionHub**（`src/core/serve/sessionHub.ts`）：
  - `ManagedSession.agentMode`（运行中可变，**不参与 runtimeMatches**——切档不重启引擎）+ `lastSyncedAgentMode`（下游撤回 agent_mode 后仍需退出 plan）+ `currentEngineModeId` 镜像；
  - `reconfigureSession` 在 runtimeMatches 早退前刷新 `agentMode`；
  - 队列循环**逐 prompt** 调 `syncBusinessModeToEngine`（模式经 `resolveEngineModeInfo({modes, configOptions})` 重新发现），applied 后同步 `session.modes.currentModeId` 并 `broadcastState`（Console 下拉刷新）；
  - 审批策略 getter：`agentMode==="yolo" → "yolo"`、`"ask"/"plan" → "ask"`（serve 即 SSE 远程审批），未下发时回落网关默认；
  - `onRawUpdate` 消费 `current_mode_update` 维护镜像。
- **渲染**：终端 `chat` 输出 `[✓/▸/·]` checklist 与 `[mode → x]` 提示；Console（`src/core/ui/appHtml.html`）reducer 处理 plan 家族 + 模式切换系统消息 + 计划条目样式。

---

## 7. 引擎侧

### 7.1 claude-code-acp-ts（上游已完备，**零改动**）

`buildAvailableModes` 含 `plan` 档 → SDK `setPermissionMode("plan")`；TodoWrite/Task 工具 → plan 条目；ExitPlanMode → `switch_mode` 审批；`current_mode_update` 广播。是本方案的行为基准。

### 7.2 nuwaxcode（opencode fork，4 项补齐）

- **question 桥接（bug 修复）** `src/acp/question.ts`：`question.asked` 事件 → ACP `request_permission`。此前 `plan_exit` 工具的确认问题在 ACP 下无人应答会**永久挂起**。要点：`plan_enter`/`plan_exit` 触发的问题映射 `kind:"switch_mode"`（`event.ts` 的 Subscription 维护 callID→工具名映射）；客户端选中 reject_once 选项或取消 → `question.reject`（不得把否定标签当答案回填）；client 无 requestPermission 通道 → 立即 reject 而非挂起；选项映射 首项=allow_once 其余=reject_once。
- **current_mode_update** `src/acp/service.ts`：`sendCurrentModeUpdate` 在 `set_session_mode` 与 `mode` config option 两条路径成功后广播（best-effort）。
- **todo → plan** `src/acp/event.ts`：`todo.updated` 事件 → `sessionUpdate:"plan"` 全量条目（`cancelled` → `pending`、未知 priority → `medium`；空列表不发射）。
- **plan_enter 工具** `src/tool/plan.ts` + `registry.ts`：实现 PlanEnterTool（确认后注入 `agent:"plan"` 合成用户消息，与 plan_exit 对称）；plan 工具门控从 `client==="cli"` 扩展到 `client==="acp"`，仍受 `OPENCODE_EXPERIMENTAL_PLAN_MODE` 总开关控制。
- modes **不**在 session 响应返回（规范为 MAY，合规），经 `mode` config option 暴露——由客户端 fallback 通道发现（§3）。

### 7.3 deepagents-flow-ts

- `libs/deepagents-acp/types.ts` 新增 `onSessionMode` hook；`server.ts` 的 `handleSetSessionMode` 调 hook 并广播 `current_mode_update`。
- `surfaces/acp/server.ts` 让 set_mode 真正生效：`applySessionModeToPermissions`（plan 档把 interruptOn 扩至 `write_file/edit_file/bash/http_request` 写四件套；ask 档强制 ask；agent/未知保持 appConfig 默认）+ `applySessionModeToQuery`（plan 档向输入追加规划指令；resume 分支不注入，保持续跑语义）。

### 7.4 codex-acp-ts

- `AgentMode.ts` 新增 `Plan` 档（Agent 同款审批/沙箱预设：on-request + workspaceWrite），`all()` 纳入 modes 声明——四引擎 modeId 统一为 `"plan"`，客户端零 per-engine 分支。
- `CodexAcpServer.ts` `syncCollaborationWithSessionMode`：plan ↔ default 联动 codex `collaboration_mode`（`setSessionMode` 与 `mode` config option 两路径；best-effort，RPC 失败仅记日志不阻断 set_mode）。
- 已知差距：set_mode 后不广播 `current_mode_update`（规范为描述性 "can"，非 MUST；客户端在 applied 后有乐观镜像兜底）。

---

## 8. 兼容性矩阵（以代码为据）

| 能力 | claude-code-acp-ts | nuwaxcode | deepagents-flow-ts | codex-acp-ts |
|---|---|---|---|---|
| modes 发现通道 | session 响应 `modes` | `mode` config option（fallback 通道） | session 响应 `modes` | session 响应 `modes` |
| plan modeId | `plan` | `plan`（opencode plan agent） | `plan` | `plan`（本轮新增） |
| set_mode 落地 | SDK permission mode | prompt 时作 `agent:` 参数 | 权限门控 + 指令注入（本轮生效化） | AgentMode 预设 + collaboration 联动 |
| plan 条目发射 | TodoWrite/Task | todo.updated（本轮新增） | AcpPlanCoordinator | turnPlanUpdated |
| 退出 plan 审批 | ExitPlanMode（switch_mode） | plan_exit → question 桥（本轮修复挂起） | 审批卡（interruptOn） | on-request 审批预设 |
| current_mode_update | ✅ 原生 | ✅ 本轮 | ✅ 本轮 | ❌（非 MUST，差距见 §7.4） |
| 对客户端 `plan:{}` 能力声明的处理 | — | zod strip 未知键，无害接收（已核实） | — | — |

## 9. 验证状态（测试基线）

| 仓库 | 结果 |
|---|---|
| agent-kit 0.4.0 | 84/84（新增 29：模式协商三通道、apply 容错、业务档同步、分类器全 case、capabilities） |
| nuwaclaw | acp 套件 61/61（新增 6 plan：下发/fallback/config-option 推导/降级/退出恢复/镜像去重 + 5 mapper）；全量 1205 过，失败均存量（基线 38） |
| nuwax | 相关套件通过，全量 765 过、与基线相比零新增失败；typecheck 触点文件干净 |
| nuwa-cli | 565+ 过、零新增失败、tsc 干净（新增 10：连接层 plan 路由/能力声明、config 解析、逐 prompt 同步三场景） |
| nuwaxcode | acp + question 套件 152/152（含 5 个新增桥接用例）；扩至 tool/agent 共 482 过、1 失败为存量（基线同样失败）；tsgo 触点文件干净 |
| deepagents-flow-ts | plan 相关 36/36（新增 7）；全量 396 过（2 flaky 存量，基线同套件挂 9） |
| codex-acp-ts | 333/333（新增 4：plan 广告/联动/恢复/幂等）；typecheck 干净 |

## 10. 发布与部署注意

1. **agent-kit 0.4.0 需发布 npm**；发布后移除两处本地 `file:` 指向：nuwaclaw 根 `package.json` 的 `pnpm.overrides["@nuwax-ai/agent-kit"]`、nuwa-cli `package.json` 的依赖（改回 registry pin `0.4.0`）。agent-kit src 变更后的刷新流程：`pnpm --dir crates/agent-kit test`（重建 dist）→ 根 `pnpm install` → nuwa-cli `npm install`。
2. **nuwaxcode 改动需重编二进制**并更新 nuwaclaw `resources/nuwaxcode` 后桌面才生效；plan_enter/plan_exit 工具需 `OPENCODE_EXPERIMENTAL_PLAN_MODE`。
3. nuwax UI 随 submodule pin bump 发布（既有流程）。
4. agent-platform 零改动；建议 nuwaclaw 与 nuwa-cli 两种网关形态各做一次云上回归（`subType=plan` 的 `data.entries` 消费）。

## 11. 遗留差距与演进

| 项 | 性质 | 建议 |
|---|---|---|
| codex 不发 `current_mode_update` | 非违规（规范非 MUST），客户端乐观镜像已兜底 | 一行级补齐可统一四引擎行为 |
| `plan_update` 草案包装形态（`{plan:{id,type,entries}}`）未解析 | 无现实影响（无引擎按草案发包） | 前瞻加固：agent-kit 分类器读 `update.entries ?? update.plan?.entries` |
| v2 迁移 | 方向已知：v2 stable `plan_update` 免能力声明、`ClientCapabilities.plan` 移除、旧 `plan` 变体删除、set_mode 进一步 config-option 化 | 迁移时客户端需补包装解析 + 能力声明调整；当前"stable plan 为主 + 实验变体超前兼容"姿态与 v2 不冲突 |
| nuwax 侧按 engine id 隐藏 plan 档 | 未做（需引擎元数据经 agent-platform 下发） | 现由引擎端优雅降级（无 plan mode 保持默认并记日志）兜底 |

---

## 12. 未来接入：云电脑 rcoder（本轮**未实施**，仅为规划）

> 事实基准：`/Users/apple/workspace/rcoder` @ `feature-userapp`（`5922d2c3`，2026-08-26，当前活跃分支）。
> **本节仅为规划与现状盘点，本轮（2026-08-26 ~ 2026-08-27）未对 rcoder 做任何代码改动**；§1-§11 的已实施范围不含 rcoder。

### 12.1 rcoder 在链路中的位置

rcoder 是**云电脑（Docker/K8s pod）形态的 Agent Computer**：Rust 平台（Axum HTTP + agent_runner gRPC/容器内引擎 + Pingora 代理 + supervisord 引擎管理）。它与 nuwaclaw / nuwa-cli 实现同一套 `/computer/*` HTTP+SSE 契约（`crates/rcoder/src/router.rs:69-85`：chat / agent/stop / agent/status / agent/session/cancel / **notify-resolved** / progress SSE / pod/*），即 agent-platform `SandboxAgentClient` 可将云 pod 指向 rcoder——业务 plan 档的 `agent_mode`（String）经云端透传后天然到达 rcoder 的 `/computer/chat`。

引擎驱动层为 SACP（对 [`agent_client_protocol`](https://docs.rs/agent-client-protocol) Rust crate 的封装）：`crates/agent_abstraction`（launcher/claude_code_sacp、acp_worker、AcpSessionManager）。

### 12.2 现状盘点（对照本方案的能力面）

| 能力 | rcoder 现状 | 代码依据 |
|---|---|---|
| SSE 透传 plan / current_mode_update | **已就绪**：`SessionUpdate` 枚举已含 `Plan` / `CurrentModeUpdate` / `ConfigOptionUpdate` 变体，随 `agentSessionUpdate` 通知下发 | `shared_types/src/model/agent_session_notify.rs:278-290`；`rcoder/src/handler/docs.rs` 已列入 SSE 契约表 |
| 审批链路（ExitPlanMode 类 `switch_mode`） | **已就绪**：request_permission → permission_manager / permission_handler → `/computer/notify-resolved` | `agent_runner/src/service/permission_manager`、`rcoder/src/handler/permission_handler.rs` |
| 业务 `agent_mode` | **部分**：`shared_types::AgentMode` 仅 `Yolo \| Ask`（serde 默认 Yolo） | `shared_types/src/agent/chat_config.rs:15-21` |
| `session/set_mode` 下发 | **最小实现**：仅 `agent_mode=Ask` 时对 claude-code 引擎下发 `set_mode("default")`（危险操作需审批语义），其余引擎不下发；无 plan 档、无退出恢复、无去重镜像 | `agent_abstraction/src/launcher/claude_code_sacp/connection/setup.rs:347-385`（`apply_ask_session_mode`） |
| 引擎 modes 发现 | **未做**：NewSession 响应只取 `session_id`（`config_options: None`），未缓存 `SessionModeState` | `setup.rs:316-330` |
| initialize 能力声明 | 需确认是否声明 Terminal / plan（Rust crate 侧） | — |

### 12.3 接入计划（对齐 §3 共享语义，Rust 侧实现）

1. **业务档扩展**：`AgentMode` 枚举加 `Plan`。注意 serde 兼容——云端透传的是 String，未知值需回落默认（对齐 nuwaclaw `resolveEffectiveMode` 的 fail-safe 语义），避免旧 pod 收到 `plan` 反序列化失败。
2. **modes 发现与镜像**：NewSession / Load 响应读取并缓存 `SessionModeState`（Rust crate 已有该类型），维护会话级 `current_engine_mode_id` 镜像；`CurrentModeUpdate` 通知到达时更新（SSE 枚举已有该变体，仅需在会话管理层挂钩）。
3. **逐 chat 同步**：以 Rust 重实现 `syncBusinessModeToEngine` 语义（plan → `set_mode("plan")`，容错 Method-not-found → `set_config_option("mode")`；ask/yolo → 仅当处于 plan 时恢复初始档；失败不阻断 prompt）。可优先在 `claude_code_sacp` launcher 落地，再推广到 nuwaxcode/codex launcher；**语义以 agent-kit `sessionMode.ts` 为规范源**（本文 §3），建议同步补一份 Rust 单测对齐三类用例（下发/fallback/退出恢复）。
4. **plan 档审批折算**：plan → 权限链按 Ask 处理（rcoder 已有 ask 审批链，`switch_mode` 类请求对齐现有 acpRequestPermission 下行）。
5. **契约与消费回归**：`/computer/progress` SSE 的 `subType=plan`（`data.entries`）与 `current_mode_update` 形状与本方案 §1 下行一致，agent-platform `SandboxAgentClient.java:849/1256` 零改动消费；需补一次 nuwax → agent-platform → rcoder pod → claude-code 引擎的端到端回归（TodoWrite 出计划卡 → ExitPlanMode 审批 → current_mode_update 回传）。
6. **可选**：rcoder-cli（`crates/rcoder-cli`）本地 chat 已引用 agent_mode，plan 档渲染可参照 nuwa-cli 终端 checklist。

### 12.4 差异与风险提示

- **不能直接复用 agent-kit**（TS 包）：共享语义以"规范源 + 各端实现"方式对齐（同 §2 规范基线），建议在本文档维护语义唯一出处，Rust/TS 实现各自对齐并互测。
- rcoder 的 `apply_ask_session_mode` 硬编码 claude-code → `"default"` 映射，接入 plan 后应改为"modes 发现驱动"（与 nuwaclaw 早期"ask/yolo 不下发"演进到本方案的路径一致）。
- 云 pod 镜像版本碎片：plan 档上线需灰度（旧 pod 收到 `plan` 应回落 Yolo/Ask 语义而非报错，见第 1 点 serde 兼容）。

---

## 13. 会话内 plan 文档渲染路线（本轮未实施，规划）

"plan 即文档"的三个真实来源：nuwaxcode 的 plan agent 只允许写 `.opencode/plans/*.md`（`agent.ts` 权限配置），plan 本体是工作区文件；claude-code 的 ExitPlanMode 在 `request_permission` 的 `toolCall.content` 内联完整 plan 文本；ACP v2/RFD 已定义文档型 plan 变体——`plan_update {plan:{type:"markdown", content}}` 与 `{plan:{type:"file", uri}}`。当前实现只覆盖 stable v1 的 `items` 清单形态。

| 层级 | 内容 | 改动面 |
|---|---|---|
| L0（已就绪） | 清单卡片（四引擎）+ claude 审批卡内联 plan 文本 | 无 |
| L1 近期 | nuwaxcode plan 文件卡片：引擎侧经 `Session.plan()` 计算文件路径，随 plan 更新以 `_meta` 附带；nuwax PlanProcess 加"查看文档"入口，点击走现有文件预览（AppDev 文件树/预览、桌面 file-server） | nuwaxcode ACP 层 + nuwax 卡片，零协议/零后端改动 |
| L2 对齐 v2 | agent-kit 分类器解析 `{plan:{type:"markdown"\|"file"}}` 变体（含 §11 的 `update.plan?.entries` 加固）；nuwax PlanProcess 扩展 markdown 内联渲染（复用 MarkdownCustomProcess）与 file 预览两种变体；nuwaxcode 改发 file 变体 | agent-kit + nuwax + nuwaxcode，本地 SSE 链路原样透传天然可达 |
| L3 云端组件 | agent-platform `buildComponentExecutingPlan` 只认 `data.entries`，文档型 plan 会被丢弃——云端消费文档型需扩展组件类型 | agent-platform（打破零后端改动，与 rcoder 接入同期评估） |

---

## 14. 向后兼容与灰度（新客户端上线）

plan 档端到端涉及"新客户端 → 旧/新云端 → 旧/新引擎适配器 → 旧/新网关"的任一组合，逐面核对（2026-08-27）：

| 兼容面 | 旧侧形态 | 行为 | 结论 |
|--------|----------|------|------|
| 云端 agent_mode 透传 | 现网 agent-platform | `agentMode` 是既有 String 字段，`setAgentMode(tryReqDto.getAgentMode())` 为既有代码 | **无云端版本要求** |
| 云端 plan SSE 消费 | 现网 | `subType=="plan"` + `data.entries` 消费为既有能力；更老版本云端不认识该 subType → 静默忽略 | 降级安全：仅无计划卡，无报错 |
| 云端 current_mode_update | 任意 | 未匹配的 subType 被忽略 | 降级安全：无模式切换 toast |
| claude 引擎 | 桌面 bundled 0.65.0 | 上游已完备（本轮零改动，产物已验证含 Plan Mode/ExitPlanMode/current_mode_update） | **一期灰度首选引擎** |
| 旧 nuwaxcode 二进制 | 桌面 bundled（未含本轮 4 项改动） | `modes` 字段缺失 → 客户端 config-option fallback 发现；`build/plan` agent 切换（set_mode）旧引擎已支持；无 plan 条目发射、`plan_exit` 挂起问题依旧 | 模式切换可用、计划卡缺失；新二进制随客户端发版替换后完整 |
| 旧 nuwax webview（未升级） | 线上构建 | 输入框无 plan 档 → 用户无入口下发 `agent_mode=plan` | 自然兼容（新能力仅新前端可见） |
| 旧 nuwa-cli 网关 | npm 0.2.x | 请求带 `agent_mode=plan`，旧版 `DownstreamSessionConfig` 忽略未知字段 → 默认审批行为 | 降级安全（JSON 宽松解析） |
| agent-kit 0.4.0 | peer `^0.26.0 \|\| ^1.2.1` | 结构化类型不引 SDK 运行时；发布顺序：先 npm 发 0.4.0 → 再发客户端，并移除两处本地 `file:` 指向（§10） | 发布顺序即兼容约束 |
| initialize 声明 `plan:{}` | 旧引擎（SDK 0.16 等） | zod 默认 strip 未知键（已核实） | 无害 |
| rcoder 云 pod | 旧镜像收到 `plan` | `AgentMode` serde 枚举无此值——**需在接入时保证未知值回落而非反序列化失败**（§12.3 第 1 点） | 接入前置条件，非本次风险 |

**灰度建议**：一期以 claude 引擎放开 plan 档（能力最全、零引擎侧依赖）；nuwaxcode 档位随新二进制发版再放开；云端零发布即可开始灰度。
