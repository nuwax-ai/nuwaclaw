# 首消息性能优化报告

**日期**: 2026-03-23
**优化目标**: 降低首消息（冷启动）Agent 响应延迟
**优化前**: ~1662ms
**优化后**: ~349ms
**提升幅度**: **79%**

---

## 1. 问题分析

### 1.1 原始性能数据

首消息 `ensureEngineForRequest` 耗时分解：

```
ensureEngine 总耗时: 1662ms
├── parseCtxServers: 5ms
├── syncMcp: 1315ms ← 主要瓶颈（79%）
└── getOrCreate: 342ms
    ├── memory: 231ms
    └── init: 102ms
```

### 1.2 瓶颈定位

| 阶段 | 耗时 | 占比 | 说明 |
|------|------|------|------|
| `syncMcpConfigToProxyAndReload` | 1315ms | 79% | MCP 代理同步，首消息必须等待 |
| `ensureMemoryReadyForSession` | 231ms | 14% | Memory 服务初始化 |
| `engine.init` | 102ms | 6% | ACP 引擎进程启动 |
| 其他 | 14ms | 1% | 配置解析、MCP 提取等 |

---

## 2. 优化方案

### 2.1 优化一：MCP Proxy Bridge 预热

**原理**: 在服务 `init()` 时后台预热 MCP proxy bridge，避免首消息同步阻塞。

**代码位置**: `src/main/services/engines/unifiedAgent.ts`

```typescript
/**
 * 🚀 性能优化：后台预热 MCP proxy bridge
 * 在 init() 时调用，避免首包 syncMcp 阻塞 ~1.3s
 */
private warmupMcpBridge(): void {
  (async () => {
    try {
      const { syncMcpConfigToProxyAndReload } = await import("../packages/mcp");
      // 使用空配置预热（仅启动默认服务如 chrome-devtools）
      await syncMcpConfigToProxyAndReload({});
      log.info("[UnifiedAgent] ✅ MCP proxy bridge 预热完成");
    } catch (err) {
      log.warn("[UnifiedAgent] MCP proxy bridge 预热失败:", err);
    }
  })().catch(() => {});
}
```

**调用时机**: 在 `init()` 方法末尾调用，与其他预热任务（Engine 预热、Memory 预热）并行执行。

### 2.2 优化二：syncMcp 与 ensureMemoryReady 并行执行

**原理**: 当 MCP 配置变更且需要创建新引擎时，将 `syncMcp` 和 `ensureMemoryReady` 并行执行。

**代码位置**: `src/main/services/engines/unifiedAgent.ts` → `ensureEngineForRequest()`

```typescript
// 🚀 性能优化：只有在 MCP 配置变更时才调用 syncMcpConfigToProxyAndReload
// 同时，如果需要创建新引擎（无现有引擎），并行执行 ensureMemoryReady
const needCreateEngine = !existingEngine || !existingEngine.isReady;
let memoryReadyPromise: Promise<void> | null = null;

if (mcpChanged) {
  const syncStart = Date.now();
  try {
    const { syncMcpConfigToProxyAndReload } = await import("../packages/mcp");
    const syncPromise = syncMcpConfigToProxyAndReload(requestMcpServersEarly);

    // 🚀 性能优化：如果需要创建新引擎，并行执行 ensureMemoryReady
    if (needCreateEngine && memoryService.isInitialized()) {
      memoryReadyPromise = memoryService.ensureMemoryReadyForSession()
        .then(() => {
          log.debug(`⏱️ [PERF] ensureMemoryReady 并行完成: ${Date.now() - syncStart}ms`);
        })
        .catch((err) => {
          log.warn("[UnifiedAgent] Memory sync check failed:", err);
        });
    }

    await syncPromise;
  } catch (e) {
    log.warn("[UnifiedAgent] 动态同步 MCP 配置到 proxy 失败:", e);
  }
}
```

**`getOrCreateEngine` 方法修改**:

```typescript
async getOrCreateEngine(
  projectId: string,
  effectiveConfig: AgentConfig,
  memoryReadyPromise?: Promise<void> | null,  // 新增参数
): Promise<AcpEngine> {
  // ...

  // 🚀 性能优化：如果已有并行的 memoryReadyPromise，直接等待它
  if (memoryReadyPromise) {
    await memoryReadyPromise;
  } else if (memoryService.isInitialized()) {
    await memoryService.ensureMemoryReadyForSession();
  }

  // ...
}
```

### 2.3 已有优化（复用）

以下优化在之前已实现，本次优化复用：

1. **快速路径 1**: 无配置变更 → 直接返回现有引擎（7ms）
2. **快速路径 2**: MCP 未变更 → 跳过 syncMcp
3. **Engine 预热池**: 预热 claude-code 和 nuwaxcode 引擎
4. **Memory 预热**: `init()` 时后台执行 `ensureMemoryReadyForSession()`

---

## 3. 测试对照

### 3.1 测试环境

- **应用版本**: 0.9.1
- **测试时间**: 2026-03-23 17:53
- **测试场景**: 重启应用后发送首条消息

### 3.2 优化前日志（2026-03-20）

```
ensureEngine 总耗时: 1662ms
├── parseCtxServers: 5ms
├── syncMcp: 1315ms
└── getOrCreate: 342ms
    ├── memory: 231ms
    └── init: 102ms
```

### 3.3 优化后日志（2026-03-23）

```
[17:52:55] [info] 🔥 后台预热 Engine: claude-code
[17:52:55] [info] 🔥 后台预热 Engine: nuwaxcode
[17:52:55] [info] ✅ 预热 Engine 就绪，等待复用: claude-code
[17:52:56] [info] ✅ MCP proxy bridge 预热完成
[17:52:58] [info] ✅ 预热 Engine 就绪，等待复用: nuwaxcode

[17:53:34] 首消息请求到达
[17:53:34] [debug] ⏱️ [ensureEngine][PERF] 解析 context_servers 耗时: 6ms
[17:53:34] [info]  ⏱️ [PERF] 走完整路径: 无现有引擎, MCP变更(新7个)
[17:53:34] [debug] ⏱️ [PERF] ensureMemoryReady 并行完成: 2ms
[17:53:34] [info]  ⏱️ [PERF] syncMcp 完成: 耗时 2ms | 并行memory=true
[17:53:34] [debug] ⏱️ [ensureEngine][PERF] 提取 real MCP servers 耗时: 0ms
[17:53:34] [debug] ⏱️ [ensureEngine][PERF] ensureBridgeStarted(有MCP) 耗时: 0ms
[17:53:34] [debug] ⏱️ [getOrCreateEngine][PERF] 等待并行 ensureMemoryReady 完成: 231ms
[17:53:34] [debug] ⏱️ [getOrCreateEngine][PERF] engine.init 耗时: 105ms
[17:53:34] [info]  ⏱️ [getOrCreateEngine][PERF] 总耗时: 336ms | 使用并行memory=true
[17:53:34] [info]  ⏱️ [ensureEngine][PERF] 总耗时: 349ms | 并行优化=true
[17:53:34] [info]  ⏱️ [HTTP][PERF] /computer/chat 总耗时: 362ms
```

### 3.4 性能对比表

| 指标 | 优化前 | 优化后 | 提升幅度 |
|------|--------|--------|----------|
| `syncMcp` | 1315ms | 2ms | **99.8%** ↓ |
| `ensureEngine` 总耗时 | 1662ms | 349ms | **79%** ↓ |
| `/computer/chat` 总耗时 | ~1700ms | 362ms | **79%** ↓ |

### 3.5 优化后耗时分解

```
ensureEngine 总耗时: 349ms
├── parseCtxServers: 6ms
├── syncMcp: 2ms ← 预热后从 1315ms 降至 2ms
├── extractReal: 0ms
├── ensureBridge: 0ms
└── getOrCreate: 341ms
    ├── memory: 231ms ← 与 syncMcp 并行执行
    └── init: 105ms
```

---

## 4. 优化效果总结

### 4.1 关键收益

1. **MCP Proxy Bridge 预热**: 消除首消息 ~1.3s 阻塞
2. **并行执行**: Memory 准备与 MCP 同步重叠执行
3. **Engine 预热池**: 复用已启动的引擎进程

### 4.2 用户体验改善

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 首消息响应 | ~1.7s | ~0.35s |
| 用户感知 | 明显延迟 | 接近即时 |

### 4.3 注意事项

1. **预热时机**: 所有预热任务在 `init()` 末尾启动，不阻塞应用启动
2. **内存占用**: 预热引擎会占用额外内存，但通过预热池容量限制（当前 1 个/类型）控制
3. **配置变更**: 如果首消息的 MCP 配置与预热配置差异较大，仍需同步，但比冷启动快

---

## 5. 相关文件

- `src/main/services/engines/unifiedAgent.ts` - 主优化文件
- `src/main/services/packages/mcp.ts` - MCP proxy 管理
- `src/main/services/packages/mcpHelpers.ts` - MCP 配置比较工具

## 6. 参考资料

- [ACP Engine 性能优化](./architecture/ACP-ENGINE-PERF-OPTIMIZATION.md)
- [深度性能研究报告](./DEEP-RESEARCH-PERF-REPORT-2026-03-20.md)
