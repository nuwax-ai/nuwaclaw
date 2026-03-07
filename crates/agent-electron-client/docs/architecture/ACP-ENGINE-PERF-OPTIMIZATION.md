---
version: 1.0
last-updated: 2026-03-07
status: stable
---

# ACP 引擎性能优化说明

> 针对 `/computer/chat` 首次响应延迟约 10s 的优化：引擎预热池、ACP SDK 预加载、SSE 事件缓冲。  
> **适用引擎**：`claude-code-acp-ts`、`nuwaxcode`。  
> **最后更新**：2026-03-07

---

## 1. 问题与根因

### 1.1 现象

使用 nuwaxcode（或 claude-code）时，新会话首次请求的 HTTP 总耗时约 **7.5s**，加上模型推理后用户体感接近 **10s**。

### 1.2 耗时分解（来自日志）

| 阶段 | 耗时 | 说明 |
|------|------|------|
| `ensureEngine` | ~4.35s | 每次新 `project_id` 冷启动 ACP 进程（spawn + initialize handshake） |
| `ACP newSession` | ~3.1s | 每次新 project 创建 ACP session（含 MCP 连接等） |
| `ACP prompt resolved` | ~2.7s | 模型推理，无法通过客户端优化 |
| SSE 早期事件 | - | `prompt_start` 等在 SSE 连接建立前推送，前端收不到 |

### 1.3 根因

- **UnifiedAgentService** 按 `project_id` 懒惰创建 `AcpEngine`，每个新 project 都会触发一次进程冷启动。
- **rcoder（Tauri）** 在 init 时预启动进程并跨项目复用，Electron 侧未做等效预热与复用。
- **SSE**：`POST /computer/chat` 先返回 `session_id`，前端再建 `GET /computer/progress/{session_id}`，存在时间差，早期事件在无客户端时被丢弃。

---

## 2. 优化方案概览

| 优化项 | 文件 | 效果 |
|--------|------|------|
| 引擎预热池 | `unifiedAgent.ts` | 新 project 的 ensureEngine 从 ~4.35s 降至 ~0ms（复用预热引擎） |
| ACP SDK 预加载 | `unifiedAgent.ts` | claude-code 首次 init 时 ESM 加载不再占关键路径 |
| SSE 事件缓冲回放 | `computerServer.ts` | 无客户端时先缓冲，SSE 连接建立后回放，避免丢失早期事件 |

---

## 3. 实现说明

### 3.1 引擎预热池（unifiedAgent.ts）

**思路**：`agentService.init()` 完成后，后台**同时预热两种引擎**（`claude-code` 与 `nuwaxcode`），避免「init 用 claude-code、请求用 nuwaxcode」时永远无法复用。池按引擎类型存储，新 project 请求到来时按 `requestedEngine` 取用；若存在且关键配置一致则复用，并立即再预热同类型以补充池子。

**新增/修改**：

- **字段**：`warmEnginePool: Map<AgentEngineType, AcpEngine>`（按类型各一）、`warmEngineTasks: Map<AgentEngineType, Promise<void>>`
- **startWarmingEngine(engineType)**：若该类型未在池中且无进行中任务、有 baseConfig，则异步执行：`new AcpEngine(engineType)` → `init({ ...baseConfig, engine: engineType })` → 成功则 `pool.set(engineType, engine)`，失败则 destroy。
- **init()**：末尾调用 `startWarmingEngine('claude-code')` 与 `startWarmingEngine('nuwaxcode')`，双引擎同时预热。
- **getOrCreateEngine()**：
  - 按 `requestedEngine = effectiveConfig.engine || this.engineType || 'claude-code'` 从池中 `get(requestedEngine)`，若有则 `delete` 取出。
  - 若取到且与 `effectiveConfig` 的 apiKey/baseUrl/model 一致，则挂事件、`updateConfig(effectiveConfig)`、写入 `engines`/`engineConfigs`、调用 `startWarmingEngine(requestedEngine)` 补充、返回。
  - 若取到但配置不一致，则对取出的引擎 `removeAllListeners` + `destroy`，避免泄漏。
- **destroy()**：
  - 先 `await Promise.all([...warmEngineTasks.values()])` 并清空 tasks，再遍历 `warmEnginePool.values()` 并 destroy、清空池。

**配置匹配**：按请求的引擎类型从池中取用后，**必须 apiKey 与 baseUrl 一致**才复用；否则复用的进程仍是 init 时的认证，claude-code-acp-ts 会返回 "Authentication required"、内容为空。复用后调用 `updateConfig(effectiveConfig)` 同步 model/mcpServers 等；认证不一致时销毁预热引擎并走冷启动。

**MCP 与复用**：复用预热引擎时，AcpEngine 的 `this.config` 仍是 init 时的 baseConfig，而 `createSession()` 使用 `this.config.mcpServers`。若不复用后更新，本请求的 `context_servers`（已通过 ensureEngineForRequest 同步到 proxy 并写入 effectiveConfig.mcpServers）不会生效。因此复用路径中在挂事件、写入 engines 之前调用 **`warm.updateConfig(effectiveConfig)`**（AcpEngine 新增方法），使后续 `chat()` → `createSession()` 使用本请求的 MCP 配置，不影响 MCP 加载。

### 3.2 ACP SDK 预加载（unifiedAgent.ts）

**思路**：`loadAcpSdk()` 首次调用会动态 `import('@agentclientprotocol/sdk')`，在 Electron CJS 环境有一次性解析/编译开销。在 `init()` 末尾非阻塞调用一次，将此次开销移到应用启动阶段。

**实现**：在 `init()` 中、`startWarmingEngine()` 之前增加一行：

```ts
loadAcpSdk().catch(() => {});
```

不 await，失败静默忽略，不影响主流程。

### 3.3 SSE 事件缓冲回放（computerServer.ts）

**思路**：`pushSseEvent(sessionId, eventName, data)` 被调用时，若该 `sessionId` 尚无 SSE 客户端，则将事件写入内存缓冲；当有客户端通过 `GET /computer/progress/{session_id}` 连接时，先回放缓冲再正常推送新事件。

**实现**：

- **常量**：`SSE_EVENT_BUFFER_MAX = 50`，单 session 最多缓冲条数。
- **结构**：`sseEventBuffers: Map<sessionId, { events: string[]; createdAt: number }>`。
- **pushSseEvent()**：无客户端时，创建或取已有 buffer，若 `events.length < SSE_EVENT_BUFFER_MAX` 则 push 当前 payload 后 return；有客户端时逻辑不变，直接写 response。
- **GET /computer/progress/{session_id}**：在把 `res` 注册到 `sseClients` 之后，若存在该 sessionId 的 buffer，则依次 `res.write(eventPayload)` 回放，然后 `sseEventBuffers.delete(sessionId)`，并打日志。
- **stopComputerServer()**：在清空 `sseClients` 后调用 `sseEventBuffers.clear()`。
- **Cancel 与缓冲**：`POST /computer/agent/session/cancel` 会调用 `acpEngine.abortSession(sessionId)`，**会中止 ACP 会话**（停止产生 SSE 的进程）；取消成功后调用 `clearSseEventBuffer(sessionId)` **清除该 session 的 SSE 缓冲**，避免用户重连 `GET /computer/progress/{session_id}` 时仍回放已取消会话的旧事件。
- **Stop（重启动/停止）与缓冲**：`POST /computer/agent/stop` 会调用 `agentService.stopEngine(project_id)`，**会停止该 project 的整个引擎**（进程销毁，其下所有 session 终止）；停止前先通过 `acpEngine.listSessions()` 取得该引擎下所有 session id，并逐一调用 `clearSseEventBuffer(sessionId)` **清除这些 session 的 SSE 缓冲**，避免之后重连或新建 SSE 时仍回放旧事件。
- **客户端停止/重启所有服务**：客户端通过 `services.stopAll()` 或 `services.restartAll()` 停止/重启时，会调用 `serviceManager.stopAllServices()` 或 `restartAllServices()`，在调用 `agentService.destroy()` **之前**调用 **`clearAllSseEventBuffers()`**（computerServer 导出），清空全部 SSE 事件缓冲，避免重启后前端重连仍回放旧会话事件。

---

## 4. 并发与生命周期注意点（Review 结论）

- **预热池并发**：从池中取引擎必须“先 shift 再使用”；若配置不匹配，对已取出的引擎做 destroy，避免同一实例被多个请求复用或泄漏。
- **destroy 顺序**：先 await `warmEngineTask`，再销毁 `warmEnginePool` 中所有引擎并清空池，否则任务结束时 push 进池的引擎可能未被销毁。

---

## 5. 预期效果

| 阶段 | 优化前 | 优化后 |
|------|--------|--------|
| ensureEngine（新 project） | ~4.35s | ~0ms（复用预热时） |
| loadAcpSdk 首次加载（claude-code） | 串在 init 内 | 预加载，已缓存 |
| ACP newSession | ~3.1s | ~3.1s（不变） |
| 模型推理 | ~2.7s | ~2.7s（不变） |
| **HTTP 响应总时间** | **~7.5s** | **~3.1s** |
| SSE 早期事件 | 易丢失 | 缓冲回放，不丢失 |

同项目再次请求仍走现有 session 复用，无变更。

---

## 6. 相关文件

- `src/main/services/engines/unifiedAgent.ts`：预热池、SDK 预加载、getOrCreateEngine 复用与 destroy 顺序。
- `src/main/services/engines/acp/acpClient.ts`：`loadAcpSdk()` 定义。
- `src/main/services/computerServer.ts`：SSE 缓冲、回放、`pushSseEvent`、`stopComputerServer` 清理。

---

## 7. 单测覆盖

- **unifiedAgent.test.ts**：`UnifiedAgentService — 引擎预热池（ACP 性能优化）`
  - `init()` 后 `loadAcpSdk` 被调用
  - `getOrCreateEngine` 在预热完成后复用池中引擎且配置一致
  - 从池取出的引擎配置不匹配时被 `destroy`
  - `destroy()` 清空预热池且不抛
- **computerServer.test.ts**：`ComputerServer — SSE 事件缓冲`
  - `getSseEventBufferSize` 在无缓冲时返回 0
  - 无客户端时 `pushSseEvent` 将事件写入缓冲
  - 缓冲条数上限 50（`SSE_EVENT_BUFFER_MAX`）

运行：`npm run test:run` 或 `npm run test:coverage`。

## 8. 可选后续优化

- **SSE buffer TTL**：已实现。对长期无客户端连接的 sessionId 做 buffer 过期清理（30s，`SSE_EVENT_BUFFER_TTL_MS`），在 `pushSseEvent` 无客户端路径中调用 `pruneExpiredSseEventBuffers()`，避免 Map 在极端场景下增长。
- **预热配置扩展**：若未来需按 `env` 或 `mcpServers` 区分引擎，可在复用前增加比对，不匹配则销毁取出的预热引擎。
- **nuwaxcode 进程级 vs session 级 MCP**：`OPENCODE_CONFIG_CONTENT` 在进程 spawn 时注入（来自 baseConfig）；会话级 MCP 以 ACP `newSession` 的 `mcpServers`（来自 `this.config`，复用路径已由 `updateConfig(effectiveConfig)` 更新）为准。当前实现以 session 级为准，进程级仅作默认/权限等用途。

## 9. 日志分析与可优化点（2026-03-07）

### 9.1 首包 ensureEngine 耗时分解（典型 nuwaxcode 冷启动）

| 阶段 | 耗时 | 说明 |
|------|------|------|
| parseCtxServers | 0ms | 解析请求 context_servers |
| **syncMcpConfigToProxyAndReload** | **~700ms** | 首请求同步 MCP 到 proxy、写 DB、必要时重启 bridge；同 project 后续请求已跳过（1–2ms） |
| **ensureMemoryReady** | **~500ms** | 仅冷路径：memory index dirty 时做 fileSync；已通过 init 时后台预执行 `ensureMemoryReadyForSession()` 减少首包等待 |
| **getOrCreateEngine (engine.init)** | **~6s** | nuwaxcode 进程冷启动；复用预热池或同 project 复用后降至 0ms 级 |
| **同 project 后续请求** | **1–2ms** | 引擎复用生效，ensureEngine 仅做 getEngineForProject + 早期返回 |

### 9.2 已做优化

- **init 时后台预做 memory 同步**：`memoryService.ensureMemoryReadyForSession().catch(() => {})`，首包 getOrCreateEngine 时 ensureMemoryReady 多为快路径（index 已同步），减少约 500ms。
- **同 project 不误判配置变更**：已有引擎且引擎类型未切换时直接复用，避免 detectConfigChange 误判导致每次重建。
- **session_id / project_id 查找**：`getEngineForProject(engineKey)` 支持按 session_id 命中「key=project_id 但含该 session」的引擎，同一会话续传复用。

### 9.3 仍可考虑的优化（未实现）

- **syncMcp 首包 ~700ms**：当前首请求必须走一次同步；若多 project 共用相同 context_servers，可做「上次同步配置 hash」缓存，相同则跳过 sync，降低多 project 首包成本。
- **预热池命中率**：若首请求为 nuwaxcode 而 nuwaxcode 预热未就绪（约 6s），仍会冷启动；可考虑在 UI 侧延迟首条 chat 或提示「引擎准备中」，或接受首包 6s 仅发生一次。
