# Nuwax Agent v-next 优化计划（v0.10 Foundations）

> 制定日期：2026-04-11
> 状态：**进行中**
> 目标版本：v0.10.0
> 分支：`feature/v0.10-foundations`

---

## 1. 背景与目标

v0.10 Foundations 计划分五个阶段，逐步构建：进程稳定性 → Harness 工作流引擎 → 可观测性/性能 → GUI Agent → 发布就绪。

### 1.1 核心交付

| # | 交付物 | 说明 |
|---|--------|------|
| 1 | **进程稳定性** | ProcessTree + ProcessLifecycleManager，崩溃检测与自动重启 |
| 2 | **Harness 工作流引擎** | 任务分解、检查点、审批门、恢复策略 |
| 3 | **可观测性与性能** | 结构化日志、指标收集、健康仪表板、Worker Thread 卸载 |
| 4 | **GUI Agent 集成** | GUI Agent 接入（待定） |
| 5 | **发布就绪** | i18n 审计、Release 打包 |

---

## 2. 实施阶段

### 2.1 Phase 1 — 地基强化（P0/P1）

为后续 Harness 和可观测性提供稳定的进程基座和数据层。

| ID | 任务 | 优先级 | 状态 | Commit |
|----|------|--------|------|--------|
| P0 | `ProcessTree` + `ProcessLifecycleManager` | Critical | **已完成** | `7e260b8` |
| P1-A | `autoFallback=session` 语义实现 | High | **已完成** | `ed3ba99` |
| P1-B | 依赖检测并行化 + SQLite WAL 模式 | High | **已完成** | `b52ecad` |
| P1-C | Memory Service → Worker Thread（ExtractionWorkerPool） | High | **已完成** | `73c0663` |
| P1-D | SQLite Schema 升级（5 张新表 + 8 索引） | High | **已完成** | `229947e` |
| P1-E | Windows ACL 回收 | Medium | 进行中 | — |
| P1-F | Windows 网络隔离 | Medium | 进行中 | — |

### 2.2 Phase 2 — Harness 核心

工作流引擎的四大支柱模块。

| ID | 任务 | 优先级 | 状态 | Commit |
|----|------|--------|------|--------|
| P2-A | `CheckpointManager`（5 阶段检查点生命周期） | Critical | **已完成** | `229947e` |
| P2-B | `TaskExecutor`（分解 + 执行框架） | Critical | **已完成** | `229947e` |
| P2-C | `ApprovalGate` + 审批 UI（ApprovalBanner） | High | **已完成** | `229947e` + `df0fd2a` |
| P2-D | `RecoveryManager`（8 策略：retry/wait/escalate/abort/pause/skip 等） | High | **已完成** | `229947e` |
| P2-E | `harnessHandlers.ts` IPC（10 通道 + Zod 校验） | High | **已完成** | `229947e` |
| P2-F | Harness 任务 Tab（TasksPage + 检查点可视化） | Medium | **已完成** | `dc2eba9` |

#### 2.2.3 验收检查

- [x] `CheckpointManager` 支持 CP0_INIT → CP4_COMPLETE 五阶段流转
- [x] `TaskExecutor` 支持任务 CRUD + 启发式步骤分解 + 断点续跑
- [x] `ApprovalGate` 内置规则（file:delete>=5、git push、rm -rf、sudo、npm install 等）+ 60s 超时自动拒绝
- [x] `RecoveryManager` 错误分类 + 指数退避重试策略
- [x] `harnessHandlers.ts` 10 个 IPC 通道全部 Zod 校验
- [x] `TasksPage` 支持列表/创建/取消/续跑/检查点进度条/详情 Modal
- [x] `ApprovalBanner` 审批横幅嵌入 SessionsPage
- [x] Preload bridge + `electron.d.ts` HarnessAPI 类型定义
- [x] i18n: 27 个 `Claw.Tasks.*` key 覆盖 4 个 locale 文件

### 2.3 Phase 3 — 可观测性 + 性能

| ID | 任务 | 优先级 | 状态 | Commit |
|----|------|--------|------|--------|
| P3-A | 结构化日志统一（`structuredLog()` 采纳 8 个服务文件） | High | **已完成** | `df0fd2a` |
| P3-B | `HarnessMetrics` 指标收集（14 指标类型，SQLite 持久化） | High | **已完成** | `e71ed77` |
| P3-C | `AuditLogger`（审计日志，含 task/checkpoint/approval/permission 事件） | High | **已完成** | `e71ed77` |
| P3-D | 健康检查仪表板 UI（服务详情面板：uptime/PID/restarts/lastCrash） | Medium | **已完成** | `333afee` |
| P3-E | 会话切换事件驱动（`agent:event` 推送替代 3s 轮询） | Medium | **已完成** | `e71ed77` |
| P3-F | Splash screen（原生 Electron splash + 启动进度） | Low | **已完成** | `df0fd2a` |

### 2.4 Phase 4 — GUI Agent 集成

| ID | 任务 | 优先级 | 状态 |
|----|------|--------|------|
| P4-A | GUI Agent 接入 | High | 未开始 |

### 2.5 Phase 5 — 发布就绪

| ID | 任务 | 优先级 | 状态 |
|----|------|--------|------|
| P5-A | i18n locale 审计 | Medium | 进行中 |
| P5-B | Release 打包与签名 | High | 未开始 |
| P5-C | CHANGELOG 最终版 | Low | 未开始 |

---

## 3. 关键架构决策

### 3.1 ProcessTree + ProcessLifecycleManager

- `ProcessTree`（`processTree.ts`）：遍历 `/proc` 或 `ps` 构建子进程树，供杀进程时一并清理
- `ProcessLifecycleManager`（`processLifecycle.ts`）：统一监控 lanproxy/fileServer/agentRunner/guiServer 的崩溃/重启事件，广播到渲染进程（`service:lifecycle` channel）

### 3.2 Harness 工作流引擎

```
TaskExecutor (任务分解 + 执行)
    │
    ├── CheckpointManager (检查点持久化)
    │
    ├── ApprovalGate (人工审批门)
    │
    └── RecoveryManager (错误恢复策略)
```

- DB Schema v2：`tasks`、`task_checkpoints`、`approval_requests`、`harness_metrics`、`audit_logs`
- IPC：10 个通道在 `harnessHandlers.ts`，全部 Zod 校验

### 3.3 可观测性

- `structuredLog(level, service, msg, extra)` 输出单行 JSON（timestamp/level/service/sessionId/taskId/traceId/data）
- `HarnessMetrics`：record/increment/summarize/query/cleanup(30d)
- `AuditLogger`：task/checkpoint/approval/permission/engine 事件审计，cleanup(90d)

---

## 4. 依赖关系

```
Phase 1 (地基) ──→ Phase 2 (Harness) ──→ Phase 3 (可观测性)
                                              │
                                              ▼
                                    Phase 4 (GUI Agent)
                                              │
                                              ▼
                                    Phase 5 (发布就绪)
```

---

## 5. 测试策略

- Harness 模块：单元测试覆盖 CheckpointManager/TaskExecutor/ApprovalGate/RecoveryManager
- ProcessLifecycleManager：集成测试验证崩溃检测与重启
- IPC handlers：Zod schema 校验 + handler 调用链测试

---

## 6. 风险与缓解

| 风险 | 级别 | 缓解 |
|------|------|------|
| Harness 模块与 AcpEngine 耦合 | 中 | 通过 IPC 解耦，Harness 不直接依赖 acpEngine |
| SQLite Schema 升级兼容性 | 低 | 使用 `PRAGMA user_version` 版本化迁移 |
| Worker Thread 崩溃 | 低 | ExtractionWorkerPool 自动终止并回退主线程 |

---

## 7. 关键文件索引

| 文件 | Phase | 说明 |
|------|-------|------|
| `src/main/services/utils/processTree.ts` | P0 | 子进程树遍历 |
| `src/main/services/utils/processLifecycle.ts` | P0 | 进程生命周期管理 |
| `src/main/services/sandbox/policy.ts` | P1-A | autoFallback 策略 |
| `src/main/services/engines/acp/acpEngine.ts` | P1-A | 会话级策略解析 |
| `src/main/db.ts` | P1-B/P1-D | WAL + Schema 升级 |
| `src/main/services/system/dependencies.ts` | P1-B | 并行依赖检测 |
| `src/main/services/memory/worker/ExtractionWorkerPool.ts` | P1-C | Worker Thread 池 |
| `src/main/services/memory/worker/extractionWorker.ts` | P1-C | Worker 执行逻辑 |
| `src/main/services/harness/CheckpointManager.ts` | P2-A | 检查点管理 |
| `src/main/services/harness/TaskExecutor.ts` | P2-B | 任务执行器 |
| `src/main/services/harness/ApprovalGate.ts` | P2-C | 审批门 |
| `src/main/services/harness/RecoveryManager.ts` | P2-D | 恢复策略 |
| `src/main/ipc/harnessHandlers.ts` | P2-E | Harness IPC |
| `src/renderer/components/pages/TasksPage.tsx` | P2-F | 任务页面 |
| `src/renderer/components/harness/ApprovalBanner.tsx` | P2-C | 审批横幅 |
| `src/main/bootstrap/logConfig.ts` | P3-A | structuredLog |
| `src/main/services/harness/HarnessMetrics.ts` | P3-B | 指标收集 |
| `src/main/services/harness/AuditLogger.ts` | P3-C | 审计日志 |
| `src/renderer/components/pages/ClientPage.tsx` | P3-D | 健康仪表板 |

---

## 8. 验收标准（总体）

- [x] Phase 1：进程管理可统一监控，崩溃自动检测；SQLite WAL + 并行依赖检测生效
- [x] Phase 2：Harness 引擎可创建/执行/暂停/恢复任务，检查点可视化
- [x] Phase 3：结构化日志、指标、审计全链路覆盖；健康仪表板可用
- [ ] Phase 4：GUI Agent 接入
- [ ] Phase 5：i18n 审计完成，Release 就绪

---

## 9. 与 v0.10 优化计划的关系

本文档（v-next foundations）专注于 **进程稳定性 + Harness + 可观测性** 三大基座。v0.10 优化计划（`docs/v0.10-optimization-plan.md`）专注于 **合规/Windows 稳定性/交互确认** 三条 Track。两份计划并行推进，共同构成 v0.10.0 发布内容。

---

## 10. 阶段完成总览

### 10.1 Phase 1 — 地基强化

| 任务 | 状态 | 完成日期 | Commit |
|------|------|----------|--------|
| P0: ProcessTree + ProcessLifecycleManager | **已完成** | 2026-04-12 | `7e260b8` |
| P1-A: autoFallback=session 语义 | **已完成** | 2026-04-12 | `ed3ba99` |
| P1-B: WAL + 并行依赖检测 | **已完成** | 2026-04-12 | `b52ecad` |
| P1-C: Memory → Worker Thread | **已完成** | 2026-04-12 | `73c0663` |
| P1-D: SQLite Schema v2（5 表 + 8 索引） | **已完成** | 2026-04-12 | `229947e` |
| P1-E: Windows ACL 回收 | 进行中 | — | — |
| P1-F: Windows 网络隔离 | 进行中 | — | — |

**Phase 1 完成度：5/7（核心全部完成，Windows 相关进行中）**

### 10.2 Phase 2 — Harness 核心

| 任务 | 状态 | 完成日期 | Commit |
|------|------|----------|--------|
| P2-A: CheckpointManager | **已完成** | 2026-04-12 | `229947e` |
| P2-B: TaskExecutor | **已完成** | 2026-04-12 | `229947e` |
| P2-C: ApprovalGate + ApprovalBanner UI | **已完成** | 2026-04-12 | `229947e` + `df0fd2a` |
| P2-D: RecoveryManager（8 策略） | **已完成** | 2026-04-12 | `229947e` |
| P2-E: harnessHandlers IPC（10 通道） | **已完成** | 2026-04-12 | `229947e` |
| P2-F: TasksPage + 检查点可视化 | **已完成** | 2026-04-12 | `dc2eba9` |

**Phase 2 完成度：6/6（全部完成）**

### 10.3 Phase 3 — 可观测性 + 性能

| 任务 | 状态 | 完成日期 | Commit |
|------|------|----------|--------|
| P3-A: structuredLog() 统一（8 服务文件） | **已完成** | 2026-04-13 | `df0fd2a` |
| P3-B: HarnessMetrics（14 指标，SQLite） | **已完成** | 2026-04-12 | `e71ed77` |
| P3-C: AuditLogger（审计日志） | **已完成** | 2026-04-12 | `e71ed77` |
| P3-D: 健康仪表板 UI（uptime/PID/restarts） | **已完成** | 2026-04-13 | `333afee` |
| P3-E: 会话事件驱动（替代 3s 轮询） | **已完成** | 2026-04-12 | `e71ed77` |
| P3-F: Splash screen（启动进度） | **已完成** | 2026-04-13 | `df0fd2a` |

**Phase 3 完成度：6/6（全部完成）**

---

## 11. 技术债务

| 项目 | 状态 | 说明 |
|------|------|------|
| `autoFallback=session` 缺失 | **已解决** | commit `ed3ba99`：acpEngine 会话级策略解析新增 startup-only/session 分支 |
| 依赖检测串行化 | **已解决** | commit `b52ecad`：Promise.all 并行，冷启动 ~600ms → ~200ms |
| Memory 正则提取阻塞主线程 | **已解决** | commit `73c0663`：ExtractionWorkerPool 卸载到 Worker Thread |
| 会话列表 3s 轮询 | **已解决** | commit `e71ed77`：改为事件驱动 + 30s fallback |
| Windows ACL 泄漏 | 进行中 | Rust 侧 RAII Drop guard 开发中 |
| Windows 网络隔离 | 进行中 | 文档对齐中 |
| Harness 模块测试覆盖 | 待定 | CheckpointManager/TaskExecutor 单测待补 |

---

## 12. 关键约束

1. **所有新 IPC handler** 遵循 Zod 校验模式
2. **所有用户可见字符串** 添加到四个 locale 文件 + `I18N_KEYS` 常量
3. **日志输出只用英文**，UI 文本走 `t()`
4. **Harness 模块独立于 acpEngine**，通过 IPC 解耦

---

## 13. 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-04-11 | 创建计划文档，定义 Phase 1-5 | dongdada29 |
| 2026-04-12 | Phase 1 核心（P0-P1-D）全部完成；Phase 2 全部完成；Phase 3（P3-B/C/E）完成 | dongdada29 |
| 2026-04-13 | Phase 3 剩余（P3-A/D/F）完成。Phase 1-3 全部核心任务已交付。更新文档状态从"草稿"到"进行中"。Phase 4-5 待启动。 | dongdada29 |

---

*最后更新：2026-04-13*
