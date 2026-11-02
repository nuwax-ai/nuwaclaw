# Plan: 停止会话时清理 MCP 进程（浏览器 MCP 除外）

## Context

手动停止会话后，MCP 代理进程仍在运行。用户期望：停止会话时，关联的 MCP 进程也应被清理，但浏览器 MCP（chrome-devtools）是所有会话共用的，需要排除。

### 当前架构

```
PersistentMcpBridge (chrome-devtools) ← Electron 主进程管理，始终运行
                                         提供 URL 给 ACP，不受引擎销毁影响

AcpEngine (per-project)
  └── ACP Binary Process
      ├── MCP Proxy (server-A) ← stdio 子进程，随 ACP 进程死亡
      ├── MCP Proxy (server-B) ← stdio 子进程
      └── sessions: [session1, session2, ...]
```

- MCP 代理进程是 **ACP 二进制的子进程**，Electron 无法单独控制
- ACP 协议没有"按 session 停止 MCP"的 RPC 方法
- PersistentMcpBridge（chrome-devtools）在 Electron 主进程管理，不是 ACP 子进程

### 方案

**当 engine 的最后一个 session 被停止时，销毁整个 engine。** 这会杀掉 ACP 进程树（包括所有 MCP 子进程），而 PersistentMcpBridge（浏览器 MCP）不受影响，因为它独立于 ACP 进程。

下次创建 session 时，`ensureEngineForRequest()` 会自动创建新的 engine。

---

## 改动

### 1. `src/main/services/engines/acp/acpEngine.ts`

新增 getter，暴露当前 session 数量：

```typescript
get sessionCount(): number {
  return this.sessions.size;
}
```

### 2. `src/main/services/engines/unifiedAgent.ts` — `stopSession()`

在 abort + delete 之后，检查 engine 是否还有 session，没有则销毁：

```typescript
async stopSession(sessionId: string): Promise<boolean> {
  for (const [projectId, engine] of this.engines) {
    const session = engine.findSessionByProjectId(sessionId);
    if (session) {
      // abort + delete session (现有逻辑)
      ...
      // 如果 engine 下已无 session，销毁 engine（清理 MCP 子进程）
      if (engine.sessionCount === 0) {
        log.info(`[UnifiedAgent] No sessions left, destroying engine ${projectId}`);
        engine.removeAllListeners();
        await engine.destroy();
        this.engines.delete(projectId);
        this.engineConfigs.delete(projectId);
        this.engineRawMcpServers.delete(projectId);
      }
      return true;
    }
  }
}
```

这复用了 `stopEngine()` 的清理模式（line 415-444），保持一致。

---

## 不需要改动的部分

- **PersistentMcpBridge**：不受影响，它在 Electron 主进程独立运行，不是 ACP 子进程
- **processTree.ts**：已有 `killProcessTreeGraceful`，`engine.destroy()` 已调用它
- **warmEnginePool**：`ensureEngineForRequest()` 会自动从预热池获取或创建新 engine

---

## 验证

1. 创建会话 → 确认 MCP 进程启动（`ps aux | grep mcp`）
2. 停止该会话 → 确认 MCP 进程被清理（engine 无 session，被销毁）
3. 新建会话 → 确认新 engine 自动创建，MCP 重新启动
4. 多 session 场景：创建两个 session → 停止一个 → MCP 仍在（engine 还有 session）→ 停止另一个 → MCP 被清理
5. 浏览器 MCP（chrome-devtools）始终运行，不受会话停止影响
