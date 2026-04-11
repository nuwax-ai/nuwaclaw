# NuwaClaw 下一大版本优化计划 (v0.3 → v1.0)

> 制定日期：2026-04-11  
> 状态：草稿  
> 负责人：待分配  
> 目标版本：v1.0.0（生产就绪）

---

## 0. 背景与目标

当前 NuwaClaw（nuwax-agent 桌面客户端）已完成以下核心能力：

- ✅ 多引擎支持（claude-code / nuwaxcode）
- ✅ 沙箱隔离（macOS seatbelt / Linux bwrap / Windows Sandbox）
- ✅ 持久化 MCP Bridge 架构
- ✅ 长期记忆系统（Memory Service）
- ✅ 会话管理 Tab + 进程树清理
- ✅ 多平台打包（macOS / Windows / Linux）
- ✅ 系统托盘 + 开机自启动

**v1.0 目标**：从"可用"到"生产就绪"——稳定性、安全性、性能、可观测性全面提升，并完成 Harness 工作流（多步骤任务 + Human-in-the-Loop）的完整落地。

---

## 1. 优先级矩阵

| 类别 | P0（阻塞发布） | P1（核心体验） | P2（增强） |
|------|--------------|--------------|-----------|
| **稳定性** | 进程泄漏/崩溃根治 | 自动恢复机制 | 健康检查仪表板 |
| **安全性** | 沙箱 critical bug 修复 | Human-in-the-Loop 审批 | 审计日志持久化 |
| **性能** | 冷启动 < 3s | 会话切换延迟 < 200ms | 内存占用优化 |
| **可观测性** | 结构化日志 | 指标收集 | 用户可见的任务追踪 |
| **功能** | Harness Checkpoint | 多步骤任务执行 | 错误自动恢复 |

---

## 2. P0：稳定性 - 进程管理彻底重构

### 2.1 当前问题

- `AcpEngine.destroy()` 只发 SIGTERM，子进程树（nuwax-mcp-stdio-proxy + MCP server 子进程）残留
- `UnifiedAgentService.destroy()` 无超时保护，可能永久挂起
- `ManagedProcess.kill()` 无 SIGKILL 升级路径
- Windows 下 `ACE 持久化`（ACL 不回收）造成权限污染

### 2.2 解决方案

#### 2.2.1 `ProcessTree` 工具模块（已有计划，需落地）

**文件**: `src/main/services/utils/processTree.ts`

```typescript
// 进程树 kill，使用 SIGTERM→wait 3s→SIGKILL 策略
export async function killProcessTree(pid: number): Promise<void>

// 注册进程监控，用于泄漏检测
export function registerProcess(pid: number, label: string): void
export function unregisterProcess(pid: number): void
export function getLeakedProcesses(): { pid: number; label: string; age: number }[]
```

#### 2.2.2 `ProcessLifecycleManager` 守护层

**新建**: `src/main/services/utils/processLifecycle.ts`

统一管理所有子进程的生命周期：
- 进程注册/注销
- 优雅关闭序列（Electron `before-quit` 钩子）
- 崩溃检测与自动重启（可配置最大次数）
- 退出时清理 Windows ACL（调用 sandbox-helper cleanup 子命令）

#### 2.2.3 验收标准

- [ ] `ps aux | grep acp` 停止服务后无残留进程
- [ ] Windows 设备管理器无残留沙箱进程
- [ ] 压力测试：连续启停 20 次，内存无增长趋势

---

## 3. P0：安全性 - 沙箱 Critical Bug 修复

基于 `sandbox-plan.md` 审查，以下问题需在 v1.0 前修复：

### 3.1 Windows 网络隔离

**当前**: 仅做环境变量+命令桩劫持（best-effort）  
**目标**: 文档与代码对齐，明确标注局限性，提供可选的 WFP（Windows Filtering Platform）增强层

```typescript
// src/main/services/sandbox/windows/networkPolicy.ts
export interface WindowsNetworkPolicy {
  mode: 'none' | 'env-stub' | 'wfp-block';  // 新增 wfp-block 选项
  allowedHosts?: string[];
}
```

### 3.2 Windows ACL 回收

**新建 cleanup 命令**: `nuwax-sandbox-helper cleanup --workspace <path>`

- 进程退出/应用退出时自动调用
- 记录 ACL 变更日志，支持手动审计
- CI 门禁：新增"重复运行后 ACL 状态"测试

### 3.3 `autoFallback=session` 语义实现

**当前**: `startup-only` 与 `session` 行为相同（都降级 none）  
**v1.0**: 实现语义差异：
- `startup-only`：仅首次启动检测，检测失败直接拒绝会话
- `session`：每次会话启动前检测，失败时提示用户但允许降级继续

### 3.4 验收矩阵扩充

在 `docs/sandbox/sandbox-matrix.spec.json` 补充：
- 网络隔离绕过负例测试（原生 socket 客户端）
- Windows ACL 持久化/回收测试
- Linux strict 模式 `/usr/local` 覆盖测试

---

## 4. P1：Harness 工作流 - 完整落地

这是 v1.0 的**核心差异化功能**，将 NuwaClaw 从"对话式 Agent"升级为"任务执行引擎"。

### 4.1 Checkpoint 系统

**新建**: `src/main/services/harness/CheckpointManager.ts`

```typescript
enum CheckpointType {
  CP0_INIT = 'CP0_INIT',        // 任务接受
  CP1_PLAN = 'CP1_PLAN',        // 计划制定完成
  CP2_EXEC = 'CP2_EXEC',        // 执行中
  CP3_VERIFY = 'CP3_VERIFY',    // 验证结果
  CP4_COMPLETE = 'CP4_COMPLETE' // 交付完成
}

interface Checkpoint {
  id: string;
  taskId: string;
  type: CheckpointType;
  status: 'pending' | 'active' | 'passed' | 'failed';
  enteredAt: string;
  passedAt?: string;
  result?: Record<string, unknown>;
  canResume: boolean;
  resumeFrom?: CheckpointType;
}
```

**存储**: 持久化到 SQLite (`nuwax-agent.db`)，表 `task_checkpoints`

### 4.2 多步骤任务执行器

**新建**: `src/main/services/harness/TaskExecutor.ts`

```typescript
interface TaskStep {
  id: string;
  description: string;
  type: 'read' | 'write' | 'execute' | 'review' | 'approve';
  dependsOn: string[];
  checkpoint: CheckpointType;
  requiredPermissions: PermissionType[];
  riskLevel: 'low' | 'medium' | 'high';
}

class TaskExecutor {
  // 任务分解（调用 LLM 规划）
  async decompose(task: string): Promise<TaskDecomposition>
  
  // 步骤执行（含权限检查、Checkpoint 记录、结果验证）
  async executeStep(step: TaskStep, ctx: ExecutionContext): Promise<StepResult>
  
  // 断点续跑
  async resumeFrom(taskId: string, checkpoint: CheckpointType): Promise<void>
}
```

### 4.3 Human-in-the-Loop 审批

**新建**: `src/main/services/harness/ApprovalGate.ts`

触发条件（参考 `HARNESS-BUSINESS.md`）：

| 操作类型 | 触发条件 | 审批级别 |
|---------|----------|---------|
| `file:delete` | 删除超过 5 个文件 | 高 |
| `command:execute` | `git push` / `rm -rf` / `sudo` | 高 |
| `network:call` | 下载外部资源 | 中 |
| `package:install` | 安装 npm/pip 包 | 低 |

**UI 交互**：
- 主窗口顶部弹出审批横幅（Ant Design `Alert` + 操作按钮）  
- 系统通知（`Notification` API）
- 支持 60s 超时自动拒绝（可配置）

### 4.4 错误恢复策略

**新建**: `src/main/services/harness/RecoveryManager.ts`

```typescript
const DEFAULT_STRATEGIES = [
  { errorType: 'transient',           action: 'retry',    maxRetries: 3, delay: 5  },
  { errorType: 'rate_limit',          action: 'wait',     delay: 30                },
  { errorType: 'permission_denied',   action: 'escalate'                           },
  { errorType: 'security_violation',  action: 'abort'                              },
  { errorType: 'validation_error',    action: 'pause'                              },
];
```

### 4.5 IPC 扩展

新增 IPC handlers（`src/main/ipc/harnessHandlers.ts`）：

```
harness:createTask          创建任务
harness:getTaskStatus       获取任务状态
harness:listTasks           列出所有任务
harness:cancelTask          取消任务
harness:resumeTask          断点续跑
harness:respondApproval     响应审批请求
harness:getCheckpoints      获取任务 Checkpoint 历史
```

---

## 5. P1：性能优化

### 5.1 冷启动优化（目标 < 3s）

**当前瓶颈**（需 profiling 确认）：
- SQLite 初始化阻塞主进程
- 依赖检测（`checkUvVersion` 等）串行执行
- Electron `loadURL` 等待 Vite dev server

**方案**：
- 依赖检测并行化（`Promise.all`）
- SQLite 迁移异步化（`WAL` 模式 + 后台初始化）
- 生产包使用 preload 脚本预热关键路径
- 添加 splash screen（感知冷启动时间降低）

```typescript
// src/main/startup.ts - 并行化启动
async function initializeServices() {
  const [dbReady, depsReady, envReady] = await Promise.allSettled([
    initDatabase(),
    checkDependenciesParallel(),
    loadShellEnv(),
  ]);
  // ...
}
```

### 5.2 Memory Service 性能

当前 `MemoryExtractor` 每次 session 结束触发，可能阻塞主进程：

- 提取任务移入 Worker Thread（`worker_threads` 模块）
- 向量检索添加 LRU 缓存（最近 N 条记忆）
- SQLite WAL 模式（已有 checkpoint 频率优化空间）

### 5.3 会话切换延迟（目标 < 200ms）

- `SessionsPage` webview 预加载（`<webview preload>` + URL 预热）
- Cookie 同步从同步改为缓存 + 增量更新
- 活跃会话列表轮询从 3s 降至事件驱动（ACP engine emit → IPC push）

---

## 6. P1：可观测性

### 6.1 结构化日志

当前使用 `electron-log`，格式不统一：

**目标**：统一 JSON 结构化日志

```typescript
// src/main/logConfig.ts 扩展
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;         // 'engine' | 'sandbox' | 'mcp' | 'harness'
  sessionId?: string;
  taskId?: string;
  message: string;
  data?: Record<string, unknown>;
  traceId?: string;        // 用于跨服务追踪
}
```

日志文件分割：`~/.nuwax-agent/logs/YYYY-MM-DD.log`（自动轮转）

### 6.2 Harness 指标收集

**新建**: `src/main/services/harness/HarnessMetrics.ts`

指标采集（存 SQLite `harness_metrics` 表）：

| 指标 | 用途 |
|------|------|
| 任务完成率 | 衡量引擎质量 |
| 平均任务时长 | 性能基线 |
| Checkpoint 通过率 | 可靠性指标 |
| 审批响应时间 | UX 指标 |
| 错误类型分布 | 稳定性诊断 |

### 6.3 健康检查仪表板

在 `ClientPage` 服务状态区域扩展：

- 每个服务显示 `healthy / degraded / unhealthy` 状态徽章
- 点击服务卡片 → 展开详情（PID、内存、重启次数、最近错误）
- 顶部系统资源条（CPU / Memory bar，1s 刷新）

---

## 7. P2：GUI Agent 能力集成

基于 `gui-agent-comparison.md`，选择 **方案 A（Pi-Agent 轻量方案）** 正式落地：

- TypeScript 生态，与现有代码栈一致
- 4 级生命周期事件 + Hook 系统，易于接入 Harness Checkpoint
- `AbortSignal` 取消机制，与现有进程管理对齐

**集成路径**：

```
NuwaClaw ComputerServer（已有）
    ↓
GuiAgent（Pi-Agent 架构，MCP Tool 暴露）
    ↓
HarnessTaskExecutor（调度）
    ↓
ACP Engine（claude-code / nuwaxcode）
```

新增 MCP Tools：`screenshot`, `click`, `type_text`, `scroll`, `drag`, `key_press`（参考 OSWorld 的完整操作原语）

---

## 8. P2：i18n 与国际化

（与 `nuwax` 前端的 i18n 计划对齐）

- Electron 主进程错误消息国际化（当前硬编码中文）
- `src/shared/locales/` 补充 `en.json` 完整翻译
- 设置页面新增语言切换（中/英），持久化到 SQLite

---

## 9. 数据库 Schema 升级

### 新增表

```sql
-- Harness 任务
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  engine_type TEXT NOT NULL,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  metadata JSON
);

-- Checkpoint 记录
CREATE TABLE task_checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  passed_at INTEGER,
  result JSON,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- 审批请求
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  context JSON,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT,
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  expires_at INTEGER
);

-- 指标
CREATE TABLE harness_metrics (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,
  value REAL NOT NULL,
  labels JSON,
  recorded_at INTEGER NOT NULL
);

-- 审计日志
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  task_id TEXT,
  session_id TEXT,
  actor_type TEXT NOT NULL,
  resource_type TEXT,
  resource_path TEXT,
  action TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  data JSON,
  created_at INTEGER NOT NULL
);
```

### 迁移策略

- 使用 `better-sqlite3` 事务原子性升级 Schema
- 版本号存于 `settings` 表（`db_version` key）
- 升级失败：保留旧文件备份（`nuwax-agent.db.bak.<timestamp>`）

---

## 10. 实施路线图

### Phase 1：地基强化（2 周）

**目标**：P0 问题全部解决，不再有进程泄漏和沙箱 critical bug

| 任务 | 负责人 | 优先级 |
|------|--------|--------|
| `ProcessTree` + `ProcessLifecycleManager` | - | P0 |
| Windows ACL 回收 (`sandbox-helper cleanup`) | - | P0 |
| Windows 网络隔离文档/代码对齐 | - | P0 |
| SQLite Schema 升级（新增 5 张表） | - | P0 |
| 依赖检测并行化（冷启动优化） | - | P1 |

---

### Phase 2：Harness 核心（3 周）

**目标**：完整的任务执行 + Checkpoint + 审批 UX

| 任务 | 负责人 | 优先级 |
|------|--------|--------|
| `CheckpointManager` | - | P0 |
| `TaskExecutor`（分解 + 执行） | - | P0 |
| `ApprovalGate` + 审批 UI | - | P1 |
| `RecoveryManager`（自动重试） | - | P1 |
| `harnessHandlers.ts` IPC | - | P1 |
| Harness 任务 Tab（SessionsPage 扩展） | - | P1 |

---

### Phase 3：可观测性 + 性能（2 周）

**目标**：线上问题可诊断，用户感知到明显性能提升

| 任务 | 负责人 | 优先级 |
|------|--------|--------|
| 结构化日志统一 | - | P1 |
| `HarnessMetrics` 指标收集 | - | P1 |
| 健康检查仪表板 UI | - | P2 |
| Memory Service → Worker Thread | - | P1 |
| 会话切换事件驱动（替换轮询） | - | P1 |
| Splash screen | - | P2 |

---

### Phase 4：GUI Agent + i18n（2 周）

**目标**：GUI Agent 正式可用，国际化支持英语

| 任务 | 负责人 | 优先级 |
|------|--------|--------|
| GuiAgent Pi-Agent 方案集成 | - | P2 |
| 完整 MCP Tool 操作原语 | - | P2 |
| 英文翻译完整覆盖 | - | P2 |
| 设置页语言切换 | - | P2 |

---

### Phase 5：v1.0 发布准备（1 周）

| 任务 | 负责人 |
|------|--------|
| 全平台回归测试（沙箱矩阵 100% 用例通过） | - |
| 性能基准测试报告（冷启动 < 3s 达标） | - |
| CHANGELOG.md 完整更新 | - |
| 文档站更新（README / CONTRIBUTING） | - |
| GitHub Release + 多平台包发布 | - |

---

## 11. 技术债务清单

以下问题不影响 v1.0 发布，但需纳入后续迭代：

| 问题 | 严重度 | 说明 |
|------|--------|------|
| `autoFallback=session` 未实现 | 中 | 当前 startup-only 与 session 行为相同 |
| Linux bwrap 集成测试脚本损坏 | 中 | `await exec(...)` API 不匹配 |
| `docker` 后端仅 stub | 低 | 返回未包装命令 + warning |
| `compat` startup allowlist 无实际效果 | 低 | 调用链默认未传额外启动链 |
| Memory Service 无 TTL / 清理策略 | 中 | 长期运行后 DB 无限增长 |
| WebSocket 心跳无重连机制 | 中 | 断网后需手动重启 |

---

## 12. 风险与缓解

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| Harness Checkpoint 复杂度超预期 | 中 | 高 | Phase 2 先交付 MVP（无断点续跑），v1.1 完善 |
| Windows WFP 网络隔离 API 学习成本 | 高 | 中 | v1.0 保持 env-stub 并文档化局限性，WFP 进 v1.1 |
| SQLite Schema 升级失败 | 低 | 高 | 备份 + 事务回滚 + E2E 测试覆盖 |
| GUI Agent robotjs 在 Apple Silicon 兼容性 | 中 | 中 | 提前测试，准备 `@nut-tree/nut-js` 作为备选 |
| Memory Worker Thread 与 Electron 兼容性 | 低 | 中 | 降级策略：检测失败时回退主线程执行 |

---

## 13. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-04-11 | 1.0.0-draft | 初始草稿，基于代码库全面审查 |
