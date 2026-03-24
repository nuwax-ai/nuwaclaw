# PERF 专用日志文件重构方案

**日期**：2026-03-24
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

主进程 (computerServer.ts / unifiedAgent.ts)
  getPerfLogger().info(msg)   [直接写入，无 IPC]
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
| `fileServer.ts` — `perfLog()` | 渲染侧工具函数，IPC 发送 + console.log 降级 |

---

## 改动文件清单

| 文件 | 改动说明 |
|------|---------|
| `src/main/services/constants.ts` | 新增 `PERF_LOG_FILENAME_PREFIX = 'perf'` |
| `src/main/bootstrap/logConfig.ts` | 新增 `initPerfLogging()` / `getPerfLogger()`；`isArchiveLogName` 覆盖 perf TTL 清理；perf 代码移至 `initLogging` 前方 |
| `src/main/ipc/perfHandlers.ts` | **新建**：`registerPerfHandlers()` 监听 `perf:log` IPC |
| `src/main/ipc/index.ts` | 注册 `registerPerfHandlers()` |
| `src/preload/index.ts` | 暴露 `electronAPI.perf.log(msg)` |
| `src/shared/types/electron.d.ts` | 新增 `PerfAPI` 接口；`ElectronAPI` 添加 `perf: PerfAPI` |
| `src/renderer/services/integrations/fileServer.ts` | 新增 `perfLog()` 工具函数；8 处 `console.log([PERF]...)` → `perfLog(...)` |
| `src/main/services/computerServer.ts` | 导入 `getPerfLogger`；10 处 `[PERF]` log 调用替换；总耗时行加 `rid=`；SSE close 回调清理 `sseFirstEventSent` |
| `src/main/services/engines/unifiedAgent.ts` | 导入 `getPerfLogger`；10 处 `[PERF]` log 调用替换 |
| `src/main/processManager.ts` | `start()` 新增可选 `onStdoutLine` 回调，每行 stdout 触发 |
| `src/main/window/serviceManager.ts` | `startFileServer` 传入 `onStdoutLine`，解析 `create-workspace` 请求/响应行，写入 perf 日志 |

---

## 日志格式与链路示例

### 格式规则

- 统一前缀 `[PERF]`，无嵌套括号、无 emoji
- `console.time` 风格：`[PERF] label: Xms  key=val`
- 无计时的事件行（connect / firstChunk）：`[PERF] label  key=val`
- `session_id` / `project_id` 展示完整值（方便定位）；`request_id` 截取前 8 位
- 不在日志体内重复写 epoch 时间戳（electron-log 已在行首添加）

### 完整链路示例

写入 `perf.YYYY-MM-DD.log` 的完整请求链路：

```
[PERF] create-workspace: 2800ms  rid=[abc123def]
[PERF] /agent/status: 1ms  project=1541933 alive=false
[PERF] /chat received: parseBody=2ms  rid=bf1ff749  project=1541933
[PERF] /chat.validate: 0ms
[PERF] /chat.ensureWorkspace: 5ms
[PERF] engine.fullPath  engineKey=1541933
[PERF] engine.syncMcp: 50ms
[PERF] engine.extractMcp: 1ms
[PERF] engine.ensureBridge(mcp): 2ms
[PERF] engine.evictCheck: 0ms
[PERF] engine.getOrCreate: 180ms  project=1541933
[PERF] engine.ensure: 180ms  engineKey=1541933
[PERF] /chat.ensureEngine: 180ms
[PERF] /chat.acpChat: 400ms
[PERF] /chat: 607ms  rid=bf1ff749  (parseBody=2ms validate=0ms workspace=5ms engine=180ms chat=400ms)
[PERF] sse.connect  session=d632a72e-747b-482f-994d-96662855809f
[PERF] sse.register: 3ms  session=d632a72e-747b-482f-994d-96662855809f
[PERF] sse.firstChunk  session=d632a72e-747b-482f-994d-96662855809f
[PERF] sse.end: 8200ms streaming  session=d632a72e-747b-482f-994d-96662855809f
```

热路径（引擎已就绪、MCP 无变更）：

```
[PERF] /chat received: parseBody=2ms  rid=a3f9b211  project=1541933
[PERF] /chat.validate: 0ms
[PERF] /chat.ensureWorkspace: 0ms
[PERF] engine.fastPath: 1ms  engineKey=1541933
[PERF] /chat.ensureEngine: 1ms
[PERF] /chat.acpChat: 8ms
[PERF] /chat: 11ms  rid=a3f9b211  (parseBody=2ms validate=0ms workspace=0ms engine=1ms chat=8ms)
```

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

### `sseFirstEventSent` Map 生命周期
- `end_turn` 时删除（正常流程）
- `req.on('close')` 时删除（客户端断连/超时等异常流程）
- 防止 Map 无限增长泄漏

---

## 验证步骤

1. `npm run electron:dev` 启动，发起一次对话
2. 检查 `~/.nuwaclaw/logs/perf.YYYY-MM-DD.log` 是否生成，包含完整链路
3. 确认 `main.YYYY-MM-DD.log` 中不再含 `[PERF]` 行
4. 验证渲染进程 Frontend 日志也出现在 perf 文件（IPC 链路正常）
5. 确认 `[PERF] create-workspace:` 条目出现在 perf 文件，耗时约 2–4s
6. 重启应用确认 TTL 清理覆盖 `perf.*.log`
