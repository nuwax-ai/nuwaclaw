# PERF 专用日志文件重构方案

**日期**：2026-03-24（更新：2026-03-25）
**分支**：`feature/electron-client-0.9`
**状态**：已实现

---

## 背景与目标

`[PERF]` 性能日志原本混杂在 `main.YYYY-MM-DD.log` 中，难以独立提取分析。渲染进程的性能日志仅输出到 `console.log`，没有落盘，导致 **前端 → IPC → HTTP → Engine → SSE → 前端** 这条完整链路无法在一处观察。

**目标：**
- 独立日志文件 `~/.nuwaclaw/logs/perf.YYYY-MM-DD.log`
- 全链路可观测：前端耗时通过 IPC 汇入同一文件
- 统一 `request_id` / `session_id` 作为关联键，跨阶段追踪

---

## 架构

### 日志流向

```
渲染进程 (fileServer.ts)
  perfLog(msg)
    ├─ window.electronAPI.perf.log(msg)   [IPC send，fire-and-forget]
    │       │
    │   主进程 perfHandlers.ts
    │   ipcMain.on('perf:log') → getPerfLogger().info(msg)
    │
    └─ console.log(msg)   [降级：非 Electron 环境]

主进程 (computerServer.ts / unifiedAgent.ts / acpEngine.ts)
  perfEmitter.duration() / perfEmitter.point()
         │
    electron-log 'perf' 实例
         │
    ~/.nuwaclaw/logs/perf.YYYY-MM-DD.log
```

### 组件职责

| 组件 | 职责 |
|------|------|
| `logConfig.ts` — `initPerfLogging()` | 创建独立 electron-log 实例，绑定 perf 日志文件路径 |
| `logConfig.ts` — `getPerfLogger()` | 返回 perf logger；未初始化时降级到默认 log |
| `ipc/perfHandlers.ts` | 监听 `perf:log` IPC，转发到 perfLogger |
| `preload/index.ts` — `electronAPI.perf` | 暴露渲染进程 IPC 入口 |
| `preload/webviewPerfBridge.ts` | 注入 `window.NuwaClawBridge.perf` 到 webview |
| `engines/perf/perfEmitter.ts` | PERF 输出统一入口，降低业务代码侵入 |

---

## 埋点清单

### 后端埋点（主进程）

| 阶段 | 日志名称 | 含义 | 关键字段 |
|------|----------|------|----------|
| HTTP 入口 | `/chat received` | 请求接收 | rid, project |
| 参数校验 | `/chat.validate` | 校验耗时 | - |
| 工作区准备 | `/chat.ensureWorkspace` | 工作区创建 | - |
| 引擎准备 | `/chat.ensureEngine` | 引擎初始化 | - |
| 引擎复用 | `engine.fastPath` | 复用已有引擎 | engineKey |
| 引擎创建 | `engine.fullPath` | 新建引擎 | engineKey |
| MCP 同步 | `engine.syncMcp` | MCP 配置同步 | - |
| Bridge 启动 | `engine.ensureBridge` | MCP Bridge 启动 | - |
| 引擎就绪 | `engine.ensure` | 引擎准备总耗时 | engineKey |
| ACP 调用 | `/chat.acpChat` | ACP 请求耗时 | - |
| 会话准备 | `acp.chat.sessionSetup` | 会话查找/创建 | sessionId, isNewSession, engine, model |
| 记忆注入 | `acp.chat.memoryInject` | 记忆上下文注入 | enabled |
| Chat 总耗时 | `acp.chat.total` | chat() 总耗时 | sessionId, isNewSession, engine, model |
| 引擎初始化 | `acp.init.config/spawn/handshake/total` | 引擎启动各阶段 | engine |
| 会话创建 | `acp.session.create` | ACP 会话创建 | mcpCount |
| Prompt 执行 | `acp.prompt.prepare/wait` | Prompt 处理 | sessionId, stopReason |
| SSE 连接 | `sse.connect` | SSE 连接建立 | session |
| SSE 注册 | `sse.register` | SSE 客户端注册 | session |
| SSE 首块 | `sse.firstChunk` | 首数据块到达 | session |
| SSE 结束 | `sse.end` | 流结束 | session, streaming 耗时 |

### 前端埋点（Webview 页面）

通过 `webviewPerfBridge.ts` 注入 `window.NuwaClawBridge.perf` API：

```javascript
// Web 页面中调用
window.NuwaClawBridge.perf.mark('stage_name', { key: 'value' });
window.NuwaClawBridge.perf.markOnce('unique_key', 'stage_name', { mid: 'xxx' });
```

日志格式：`[PERF][FE] stage=xxx route=/home/chat/xxx/xxx ts=xxx extra={...}`

**启用条件**：
- 路由匹配 `/home/chat/:id/:agentId`
- 页面存在 `[data-nuwaclaw-perf-scope="chat-root"]` 元素

---

## 完整链路示例

写入 `perf.YYYY-MM-DD.log` 的完整请求链路：

```
[PERF] create-workspace: 2800ms  rid=[abc123def]
[PERF] /chat received: parseBody=2ms  rid=bf1ff749  project=1541933
[PERF] /chat.validate: 0ms
[PERF] /chat.ensureWorkspace: 5ms
[PERF] engine.fullPath  engineKey=1541933
[PERF] engine.syncMcp: 50ms
[PERF] engine.ensureBridge(mcp): 2ms
[PERF] engine.ensure: 180ms  engineKey=1541933
[PERF] /chat.ensureEngine: 180ms
[PERF] /chat.acpChat: 400ms
[PERF] acp.chat.sessionSetup: 50ms  stage=会话准备 sessionId=xxx isNewSession=true engine=claude-code model=claude-sonnet-4-6
[PERF] acp.chat.memoryInject: 5ms  stage=记忆注入 enabled=false
[PERF] acp.chat.total: 410ms  stage=总耗时 sessionId=xxx isNewSession=true engine=claude-code model=claude-sonnet-4-6
[PERF] /chat: 607ms  rid=bf1ff749  (parseBody=2ms validate=0ms workspace=5ms engine=180ms chat=400ms)
[PERF] sse.connect  session=d632a72e-747b-482f-994d-96662855809f
[PERF] sse.register: 3ms  session=d632a72e-747b-482f-994d-96662855809f
[PERF] sse.firstChunk  session=d632a72e-747b-482f-994d-96662855809f
[PERF] sse.end: 8200ms streaming  session=d632a72e-747b-482f-994d-96662855809f
```

热路径（引擎已就绪、MCP 无变更）：

```
[PERF] /chat received: parseBody=2ms  rid=a3f9b211  project=1541933
[PERF] engine.fastPath: 1ms  engineKey=1541933
[PERF] acp.chat.sessionSetup: 1ms  stage=会话准备 sessionId=xxx isNewSession=false engine=claude-code model=claude-sonnet-4-6
[PERF] acp.chat.total: 5ms  stage=总耗时 sessionId=xxx isNewSession=false engine=claude-code model=claude-sonnet-4-6
[PERF] /chat: 11ms  rid=a3f9b211  (...)
```

---

## 瓶颈定位能力

| 维度 | 字段 | 用途 |
|------|------|------|
| 会话类型 | `isNewSession` | 区分首次会话 vs 连续会话 |
| 引擎类型 | `engine` | claude-code / nuwaxcode |
| 模型信息 | `model` | 当前使用的模型 |
| MCP 数量 | `mcpCount` | MCP 服务器数量影响 |
| 记忆功能 | `enabled` | 记忆注入是否启用 |

---

## 日志文件管理

- **路径**：`~/.nuwaclaw/logs/perf.YYYY-MM-DD.log`
- **大小上限**：50MB
- **级别**：info（开发/正式均相同，perf 数据本身有价值）
- **控制台输出**：禁用（避免与 main logger 重复）
- **TTL 清理**：与 main 日志一致（开发 30 天、正式 7 天）；当日文件不归档

---

## 设计决策

### `getPerfLogger()` 降级策略
未调用 `initLogging()` 时（如单元测试环境），`getPerfLogger()` 返回默认 `log` 而非抛出异常，避免测试环境因 PERF 日志崩溃。

### 渲染进程 fire-and-forget
使用 `ipcRenderer.send`（非 `invoke`），渲染进程不等待主进程写盘确认，不影响 UI 性能。

### `perfEmitter` 抽象
统一 PERF 日志输出入口，业务代码只需调用以下方法：
- `perfEmitter.duration(name, ms, extra?)` — 直接输出耗时
- `perfEmitter.point(name, extra?)` — 输出时间点
- `perfEmitter.start()` — 创建计时器，后续调用 `timer.end(name, extra?)` 自动计算并输出耗时

**计时器用法示例**：
```typescript
const timer = perfEmitter.start();
await doSomething();
timer.end('stage.name', { key: 'value' });
```

计时器模式比手动 `Date.now()` 更简洁，减少代码侵入。

---

## 验证步骤

1. `npm run electron:dev` 启动，发起一次对话
2. 检查 `~/.nuwaclaw/logs/perf.YYYY-MM-DD.log` 是否生成，包含完整链路
3. 确认 `main.YYYY-MM-DD.log` 中不再含 `[PERF]` 行
4. 验证 `acp.chat.*` 日志包含 `isNewSession`、`engine`、`model` 字段
5. 重启应用确认 TTL 清理覆盖 `perf.*.log`
