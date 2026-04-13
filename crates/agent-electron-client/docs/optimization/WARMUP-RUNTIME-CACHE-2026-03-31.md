# Warmup Runtime Config 缓存优化

**日期**: 2026-03-31
**类型**: 性能优化
**影响范围**: 新会话首消息响应（连续创建新会话场景）

---

## 1. 问题背景

### 1.1 现象

连续新开会话时，前 1-2 个会话的 warmup 复用始终 miss，日志出现：

```
[EngineWarmup] ⚠️ 运行时配置不兼容，不复用 warmup（model,apiKey,baseUrl,apiProtocol）
  warmupModel: '(none)',
  warmupBaseUrl: '(none)',
  warmupApiKeySet: false,
  warmupApiProtocol: '(none)',
```

### 1.2 实测数据（20:52 ~ 20:56，5 个连续新会话）

| # | 时间 | Warmup | Init(ms) | TTFT(ms) | 总响应(ms) |
|---|------|--------|----------|----------|-----------|
| 1 | 20:52 | ❌ cold（runtime 不兼容） | 5,705 | 9,507 | 10,389 |
| 2 | 20:53 | ❌ cold（runtime 不兼容） | 6,097 | 6,236 | 14,107 |
| 3 | 20:54:15 | ✅ reuse | 1,513 | 6,089 | 20,938 |
| 4 | 20:54:50 | ✅ reuse | 1,523 | 5,983 | 20,510 |
| 5 | 20:55:20 | ✅ reuse | 1,701 | 5,964 | 39,269 |

前两个会话 warmup miss 导致额外 ~2-4s 冷启动开销。

### 1.3 根因

**配置构建时机差异**：

```
init() 阶段:
  baseConfig = { workspaceDir, engine, env }
  ↓ 缺少 model/apiKey/baseUrl/apiProtocol

chat() 阶段:
  effectiveConfig = {
    ...baseConfig,
    model: mp?.model,           ← 来自 model_provider
    apiKey: mp?.api_key,        ← 来自 model_provider
    baseUrl: mp?.base_url,      ← 来自 model_provider
    apiProtocol: mp?.api_protocol,  ← 来自 model_provider
    mcpServers: freshMcpServers,
  }
```

- `baseConfig` 在 `init()` 时设置，不含运行时配置
- `effectiveConfig` 在每次 `chat()` 请求时动态构建
- `warmup.start(baseConfig)` 用的是不含 runtime config 的 baseConfig
- `tryReuse()` 检测到 runtime config 不一致 → 回退冷启动

**影响的三个调用路径**：

| 调用点 | 触发场景 | seedConfig | 结果 |
|--------|---------|-----------|------|
| `warmup.start(this.baseConfig)` | `init()` | ❌ 无 | warmup 缺 runtime config |
| `warmup.respawn(this.baseConfig)` | 会话结束 | ❌ 无 | 同上 |
| `ensureNuwaxWarmup({reason: "get_or_create_guard"})` | 引擎不存在 | ❌ 无 | 同上 |
| `ensureNuwaxWarmup({seedConfig: {...}})` | warmup 被消费后 refill | ✅ 有 | 正常 |
| `ensureNuwaxWarmup({seedConfig: {...}})` | 冷启动后 refill | ✅ 有 | 正常 |

**结论**：只有 refill 路径能命中，init / respawn / guard 三个路径永远 miss。

---

## 2. 修复方案

### 2.1 核心思路

在 `EngineWarmup` 内部缓存最近一次请求的 runtime config（`model/apiKey/baseUrl/apiProtocol`），在 `start()` 创建 warmup 时自动应用缓存值。

### 2.2 改动清单

| 文件 | 改动 |
|------|------|
| `engineWarmup.ts` | 新增 `lastRuntimeConfig` 缓存 + `cacheRuntimeConfig()` 方法 |
| `unifiedAgent.test.ts` | 新增 2 个测试场景 |

### 2.3 具体改动

#### `engineWarmup.ts`

**新增字段**：
```typescript
private lastRuntimeConfig: Pick<
  AgentConfig,
  "model" | "apiKey" | "baseUrl" | "apiProtocol"
> | null = null;
```

**`start()` 应用缓存**：
```typescript
const warmupConfig: AgentConfig = {
  ...baseConfig,
  engine: WARMUP_ENGINE_TYPE,
  ...(this.lastRuntimeConfig
    ? {
        model: this.lastRuntimeConfig.model || baseConfig.model,
        apiKey: this.lastRuntimeConfig.apiKey || baseConfig.apiKey,
        baseUrl: this.lastRuntimeConfig.baseUrl || baseConfig.baseUrl,
        apiProtocol: this.lastRuntimeConfig.apiProtocol || baseConfig.apiProtocol,
      }
    : {}),
  // ...
};
```

**`tryReuse()` 三条路径均缓存**：
- Runtime mismatch → `cacheRuntimeConfig(effectiveConfig)` → 后续 refill 用新缓存
- Warmup hit → `cacheRuntimeConfig(effectiveConfig)` → 保持缓存新鲜
- Warmup not ready → `cacheRuntimeConfig(effectiveConfig)` → 同上

**`dispose()` 清理**：
```typescript
this.lastRuntimeConfig = null;
```

---

## 3. 配置变更时的行为

缓存的 runtime config 与新请求配置不一致时：

```
warmup (缓存 model=A, key=X)
  ↓
新请求 (model=B, key=Y)
  ↓
tryReuse() 检测不兼容 → 回退冷启动 (~2s)
  ↓
cacheRuntimeConfig(B, Y) → 更新缓存
  ↓
refill warmup 用 (B, Y) 创建
  ↓
后续请求 (B, Y) → 命中 ✅
```

**最多影响一次会话**（配置变更的那次），后续自动纠正。这与修改前行为一致——修改前是每次都 miss，修改后仅配置变更时 miss 一次。

---

## 4. 预期效果

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 首次 init → 首次会话 | miss → 冷启动 ~3.7s | miss → 冷启动 ~3.7s（首次无缓存） |
| 首次会话后 → 第二次会话 | **miss** → 冷启动 ~2.6s | **命中** → ~1.5s（省 ~1.1s） |
| 连续新会话（配置不变） | 每次前 1-2 个 miss | 仅首次 miss，后续均命中 |
| 配置变更 | miss → 冷启动 | miss → 冷启动 → 自动纠正缓存 |

**关键指标改善**：

- 连续新会话 Init 耗时：5,705ms / 6,097ms → **~1,500ms**（reduced ~70%）
- 首消息端到端（不含 LLM TTFT）：~8s → **~6s**（节省 warmup 冷启动开销）

---

## 5. 测试覆盖

### 5.1 新增测试

| 测试 | 验证内容 |
|------|---------|
| `warmup runtime config 缓存：首次 miss 后 refill 命中后续请求` | 首次 miss → 缓存 → refill 带缓存 → 第二次命中 |
| `warmup runtime config 缓存：配置变更时回退冷启动并更新缓存` | configA miss → refill(A) → configB miss → refill(B) → B 命中 |

### 5.2 回归测试

全部 54 个 warmup 相关测试通过，包括：
- 运行时配置缺失回退冷启动（原有测试不受影响）
- MCP 配置不兼容回退冷启动
- nuwaxcode 连续命中补仓
- destroy() 清理 warmup
- persistent MCP 归一化

---

## 6. 相关文档

- [首消息性能优化报告 (2026-03-23)](./FIRST-MESSAGE-PERF-OPT-2026-03-23.md)
- [macOS 首消息性能测试报告 (2026-03-31)](./MACOS-FIRST-MESSAGE-PERF-REPORT-2026-03-31.md)
- [Session 复用修复 (2026-03-24)](./SESSION-REUSE-FIX-2026-03-24.md)

---

*文档生成时间: 2026-03-31*
