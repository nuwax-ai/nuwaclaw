# 取消 Agent 任务 — 时间优化（重构版）

> 分析范围：Electron 客户端侧「取消 agent 任务」整条链路 + 可落地优化方案。
> 最后更新：2026-03-17

---

## 1. 当前链路与实际实现

### 1.1 入口与路径（已核对代码）

| 入口 | 路径 | 最终调用 |
|------|------|-----------|
| 渲染进程 / 外部 HTTP | `computer:cancelSession` IPC 或 `POST /computer/agent/session/cancel` | `AcpEngine.abortSession(sessionId)` |
| 应用内 agent 停止 | `agent:abort` IPC | `agentService.abortSession(id)` → `engine.abortSession(id)` |

### 1.2 关键实现（acpEngine.abortSession）

当前核心逻辑：

- `ABORT_TIMEOUT = 30_000`（30s）
- 先 `await ACP cancel`（最多 30s）
- 再 `reject` 本地 prompt
- 多 session 取消为串行

对应文件：
- `/Users/apple/workspace/nuwax-agent/crates/agent-electron-client/src/main/services/engines/acp/acpEngine.ts`
- `/Users/apple/workspace/nuwax-agent/crates/agent-electron-client/src/main/services/computerServer.ts`
- `/Users/apple/workspace/nuwax-agent/crates/agent-electron-client/src/main/ipc/computerHandlers.ts`

---

## 2. 现存问题与体验风险

| 问题 | 表现 | 用户影响 |
|------|------|-----------|
| cancel 等待过长 | 固定 30s | 取消最坏 30s 才返回，体验迟滞 |
| 本地 reject 延后 | 必须等 ACP cancel | prompt() 与 UI 状态更新偏慢 |
| 多 session 串行 | 总时长累加 | 批量取消耗时线性增长 |

**新增风险（如果改成“先 reject 再 ACP”）**

- 会话在 ACP 端仍运行，但 UI 可能允许新 prompt 进入，造成重入/交叉输出风险。
- ACP 仍持续吐 SSE 更新，可能出现“取消后还继续输出”的错觉。

---

## 3. 落地方案（带安全护栏）

### 3.1 缩短 ACP cancel 等待时间（必做）

- 将 `ABORT_TIMEOUT` 从 30s 缩短至 **10s**（与 rcoder 默认一致）。
- 超时后仍按现有 catch/清理逻辑执行。

### 3.2 先 reject 本地，再等待 ACP（推荐，但必须加护栏）

目标：让 UI 和 `prompt()` **立即返回“已取消”**。

实施细节：

1. `cancelOne()` 里先：
   - `session.status = "terminating"`
   - 立即 `reject` 本地 prompt，并清理 `activePromptRejects/activePromptSessions`
2. 再发送 `ACP cancel` 并等待 `Promise.race(..., timeout)`。
3. ACP cancel 返回或超时后，再设置 `session.status = "idle"`。

**护栏（必须落地）：**

- `prompt()` 开头添加 guard：若 `session.status === "terminating"`，直接拒绝新 prompt，避免 ACP 端仍在运行时重入。
- `handleAcpSessionUpdate()` 在 session 处于 `terminating` 时，**忽略 message/tool 类 SSE 更新**（避免“取消后仍继续输出”）。

### 3.3 多 session 取消并行化（可做）

- 将 `for ... await cancelOne()` 改为 `Promise.all(...)`。
- `cancelOne()` 内部已捕获错误，因此并行不会导致整体 reject。

### 3.4 “先 200 再后台 cancel”（暂不默认）

- HTTP/IPC 可以不 await `abortSession()`，先返回 200 再后台收尾。
- 这是强 UX 优化，但语义变化较大（“已取消”并不代表 ACP 已停止）。
- 建议保留为可选策略，需产品确认语义。

---

## 4. 推荐实施顺序

1. **必做**：`ABORT_TIMEOUT` 30s → 10s
2. **推荐**：先 reject + terminating guard + SSE 抑制
3. **可选**：并行 cancel
4. **可选**：HTTP/IPC 先 200

---

## 5. 测试覆盖建议

新增单测覆盖：

- `abortSession()` 会在 ACP cancel 之前先触发本地 reject。
- `abortSession()` 超时后仍完成清理并返回。
- `prompt()` 在 `terminating` 状态被拒绝（防止重入）。
- `handleAcpSessionUpdate()` 在 `terminating` 状态下抑制输出（避免 ghost SSE）。

---

## 6. 小结

本次落地以 **“体验明显提速 + 语义不破坏”** 为原则。

核心点：

- 缩短 cancel 等待时间
- 本地快速 reject + terminating 护栏
- 可并行化提升批量取消效率
- “先 200” 保留为可选项，不强推
