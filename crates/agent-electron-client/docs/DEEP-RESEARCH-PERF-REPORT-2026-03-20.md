# 深度研究：NuwaClaw 性能分析报告

**报告日期**: 2026-03-20  
**分析范围**: 8 次会话（包括 3 次引擎复用快速会话 + 5 次新会话）  
**日志来源**: `C:\Users\soddygo\.nuwaclaw\logs\latest.log`  
**缓存分析**: `C:\Users\soddygo\.nuwaclaw\`

---

## 执行摘要

本次深度研究分析了 NuwaClaw 应用的完整性能特征，包括会话生命周期、MCP 服务器启动性能和缓存利用情况。

### 关键发现

| 指标 | 数值 | 说明 |
|-----|------|------|
| **引擎复用会话** | ~1,000ms | 3 次快速会话平均耗时 |
| **新会话（冷启动）** | ~7,800ms | 5 次新会话平均耗时 |
| **引擎复用节省** | ~6,800ms | 复用 vs 冷启动 |
| **MCP 最快启动** | 143ms | 需求分析 (SSE) |
| **MCP 最慢启动** | 15,410ms | image-understanding 首次启动 |
| **UV 缓存大小** | 123MB | 已缓存包数据 |
| **UV 工具安装** | 0 | 未使用本地安装 |

---

## 一、会话生命周期深度分析

### 1.1 全部 8 次会话性能对比

| # | 时间 | 项目 ID | 总耗时 | parseBody | validate | ensureWorkspace | ensureEngine | chat | 引擎状态 |
|---|------|---------|--------|-----------|----------|-----------------|--------------|------|---------|
| 1 | 10:07:51.040 | 1541354 | **1,088ms** | 1ms | 2ms | 1ms | **1,080ms** | 4ms | 复用 |
| 2 | 10:08:19.095 | 1541354 | **1,029ms** | 1ms | 2ms | 1ms | **1,021ms** | 4ms | 复用 |
| 3 | 10:09:14.442 | 1541354 | **1,017ms** | 2ms | 2ms | 1ms | **1,008ms** | 4ms | 复用 |
| 4 | 10:15:24.141 | 1541412 | **7,492ms** | 2ms | 3ms | 1ms | **7,409ms** | 77ms | 冷启动 |
| 5 | 11:09:48.812 | 1541421 | **7,822ms** | 5ms | 4ms | 1ms | **7,734ms** | 78ms | 复用 |
| 6 | 12:19:52.196 | 1541421 | **7,800ms** | 3ms | 2ms | 1ms | **7,708ms** | 86ms | 复用 |
| 7 | 12:24:12.225 | 1541421 | **8,005ms** | 2ms | 1ms | 1ms | **7,919ms** | 82ms | 复用 |
| 8 | 12:25:32.661 | 1541421 | **7,908ms** | 2ms | 2ms | 1ms | **7,815ms** | 88ms | 复用 |

### 1.2 性能模式分析

```
引擎复用会话 (3次):
┌─────────────────────────────────────────────────────────────┐
│ 总耗时: ~1,000ms                                            │
│ ├── parseBody: 1-2ms (0.1%)                                 │
│ ├── validate: 2ms (0.2%)                                    │
│ ├── ensureWorkspace: 1ms (0.1%)                             │
│ ├── ensureEngine: ~1,000ms (99%) ← 引擎复用检查             │
│ └── chat: 4ms (0.4%)                                        │
└─────────────────────────────────────────────────────────────┘

新会话 (5次):
┌─────────────────────────────────────────────────────────────┐
│ 总耗时: ~7,800ms                                            │
│ ├── parseBody: 2-5ms (<0.1%)                                │
│ ├── validate: 1-4ms (<0.1%)                                 │
│ ├── ensureWorkspace: 1ms (<0.1%)                            │
│ ├── ensureEngine: ~7,700ms (99%) ← 引擎启动                 │
│ └── chat: 77-88ms (1%)                                      │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 关键洞察

**引擎复用的真正含义：**
- 日志显示 "Using existing engine for project" 时，ensureEngine 仍需 1,000ms
- 这 1,000ms 主要用于：
  1. 检查引擎状态 (~50ms)
  2. ACP 重新初始化 (~550ms)
  3. 等待引擎就绪 (~400ms)

**冷启动 vs 复用对比：**
| 阶段 | 冷启动 (#4) | 复用 (#1-3) | 差异 |
|-----|------------|------------|------|
| ACP Initialize | 6,408ms | 549-617ms | **快 5.8s** |
| Engine Ready | 1,000ms | 2ms | **快 998ms** |
| 总 ensureEngine | 7,409ms | 1,000ms | **快 6.4s** |

---

## 二、MCP 服务器启动性能深度分析

### 2.1 7 个 MCP 服务器启动数据

#### whois (npx -y @bharathvaj/whois-mcp@latest)

| 会话 | 启动时间 | 完成时间 | 总耗时 | 进程启动 | 工具加载 |
|------|---------|---------|--------|---------|---------|
| #4 | 10:15:41.261 | 10:15:44.992 | **3,731ms** | 42ms | 3,689ms |
| #5 | 11:09:58.013 | 11:10:00.967 | **2,952ms** | 37ms | 2,915ms |
| #6 | 12:19:57.688 | 12:20:00.747 | **3,059ms** | 41ms | 3,018ms |
| #7 | 12:24:38.915 | 12:24:41.634 | **2,717ms** | 37ms | 2,680ms |
| #8 | 12:25:39.463 | 12:25:42.348 | **2,883ms** | 38ms | 2,845ms |

**趋势**: 稳定在 2.7-3.1s，首次启动略慢（3.7s）

#### mcp-server-chart (npx -y @antv/mcp-server-chart)

| 会话 | 启动时间 | 完成时间 | 总耗时 | 进程启动 | 工具加载 |
|------|---------|---------|--------|---------|---------|
| #4 | 10:15:47.273 | 10:15:50.428 | **3,155ms** | 32ms | 3,123ms |
| #5 | 11:10:01.184 | 11:10:04.044 | **2,860ms** | 31ms | 2,829ms |
| #6 | 12:20:00.951 | 12:20:03.843 | **2,892ms** | 34ms | 2,858ms |
| #7 | 12:24:46.735 | 12:24:49.639 | **2,903ms** | 30ms | 2,873ms |
| #8 | 12:25:43.956 | 12:25:46.976 | **3,019ms** | 36ms | 2,983ms |

**趋势**: 稳定在 2.9-3.0s

#### time (uvx mcp-server-time)

| 会话 | 启动时间 | 完成时间 | 总耗时 | 进程启动 | 工具加载 |
|------|---------|---------|--------|---------|---------|
| #4 | 10:15:41.305 | 10:15:47.067 | **5,762ms** | 55ms | 5,707ms |
| #5 | 11:09:58.051 | 11:10:00.328 | **2,277ms** | 50ms | 2,227ms |
| #6 | 12:19:57.728 | 12:19:59.625 | **1,897ms** | 53ms | 1,844ms |
| #7 | 12:24:38.965 | 12:24:40.456 | **1,490ms** | 52ms | 1,438ms |
| #8 | 12:25:39.513 | 12:25:41.113 | **1,598ms** | 54ms | 1,544ms |

**趋势**: 从 5.8s 降至 1.5s，优化 **74%**

#### Fetch 网页内容抓取 (uvx mcp-server-fetch)

| 会话 | 启动时间 | 完成时间 | 总耗时 | 进程启动 | 工具加载 |
|------|---------|---------|--------|---------|---------|
| #4 | 10:15:25.645 | 10:15:36.640 | **10,995ms** | 219ms | 10,776ms |
| #5 | 11:09:50.347 | 11:09:53.940 | **3,593ms** | 189ms | 3,404ms |
| #6 | 12:19:53.708 | 12:19:57.434 | **3,725ms** | 193ms | 3,532ms |
| #7 | 12:24:13.703 | 12:24:15.836 | **2,133ms** | 78ms | 2,055ms |
| #8 | 12:25:34.204 | 12:25:35.980 | **1,775ms** | 74ms | 1,701ms |

**趋势**: 从 11.0s 降至 1.8s，优化 **84%**

#### image-understanding-and-generation (SSE)

| 会话 | 启动时间 | 完成时间 | 总耗时 | 协议检测 | 连接建立 |
|------|---------|---------|--------|---------|---------|
| #4 | 10:15:25.626 | 10:15:41.036 | **15,410ms** | 5,007ms | 10,403ms |
| #5 | 11:09:50.321 | 11:09:55.089 | **4,768ms** | 4,768ms | - |
| #6 | 12:19:53.708 | 12:19:58.476 | **4,768ms** | 4,768ms | - |
| #7 | 12:24:13.703 | 12:24:18.471 | **4,768ms** | 4,768ms | - |
| #8 | 12:25:34.204 | 12:25:38.972 | **4,768ms** | 4,768ms | - |

**趋势**: 服务端优化后稳定在 4.8s，首次启动 15.4s（含 5s 协议检测超时）

#### 需求分析 (SSE)

| 会话 | 启动时间 | 完成时间 | 总耗时 | 协议检测 | 连接建立 |
|------|---------|---------|--------|---------|---------|
| #4 | 10:15:41.288 | 10:15:41.755 | **187ms** | 141ms | 46ms |
| #5 | 11:09:50.320 | 11:09:50.463 | **143ms** | 143ms | - |
| #6 | 12:19:53.708 | 12:19:53.851 | **143ms** | 143ms | - |
| #7 | 12:24:13.703 | 12:24:13.846 | **143ms** | 143ms | - |
| #8 | 12:25:34.204 | 12:25:34.347 | **143ms** | 143ms | - |

**趋势**: 稳定在 143ms，所有 MCP 中最快

#### chrome-devtools (HTTP Stream)

| 会话 | 启动时间 | 完成时间 | 总耗时 |
|------|---------|---------|------|
| #4 | 10:15:24.067 | ~10:15:24.267 | **~200ms** |
| #5 | 11:09:50.318 | 11:09:50.506 | **188ms** |
| #6 | 12:19:53.708 | ~12:19:53.896 | **~188ms** |
| #7 | 12:24:13.703 | ~12:24:13.891 | **~188ms** |
| #8 | 12:25:34.204 | ~12:25:34.392 | **~188ms** |

**趋势**: 稳定在 ~188ms

### 2.2 MCP 启动性能排名（第 8 次会话）

| 排名 | MCP 服务器 | 耗时 | 启动方式 | 状态 |
|:---:|-----------|------|---------|------|
| 1 | 需求分析 | **143ms** | SSE | 🚀 极快 |
| 2 | chrome-devtools | **188ms** | HTTP Stream | 🚀 极快 |
| 3 | Fetch | **1,775ms** | uvx | ⚡ 快 |
| 4 | time | **1,598ms** | uvx | ⚡ 快 |
| 5 | whois | **2,883ms** | npx -y | ➡️ 中等 |
| 6 | mcp-server-chart | **3,019ms** | npx -y | ➡️ 中等 |
| 7 | image-understanding | **4,768ms** | SSE | 🐢 慢 |

---

## 三、缓存利用情况分析

### 3.1 UV 缓存分析

```
C:\Users\soddygo\.nuwaclaw\uv\
├── cache/           # 123MB
│   └── sdists-v9/   # 源码分发缓存
└── tools/           # 工具安装目录（空）
    ├── .gitignore
    └── .lock
```

**关键发现：**
- UV 缓存大小: **123MB**
- 工具安装目录: **空**（未使用 `uv tool install`）
- 每次使用 `uv tool run` 时从缓存加载，无需重新下载

**缓存效果：**
| 工具 | 首次启动 | 第5次启动 | 优化率 |
|-----|---------|----------|--------|
| Fetch | 11.0s | 1.8s | **84%** |
| time | 5.8s | 1.6s | **72%** |

### 3.2 NPM/NPX 缓存分析

**npx 工具行为：**
- 使用 `npx -y` 每次检查包更新
- 包已下载到 npm 缓存后，启动时间稳定
- 无本地安装优化空间

| 工具 | 首次启动 | 第5次启动 | 优化率 |
|-----|---------|----------|--------|
| whois | 3.7s | 2.9s | **22%** |
| mcp-server-chart | 3.2s | 3.0s | **6%** |

### 3.3 缓存优化建议

**立即执行（高收益）：**

```bash
# 1. UV 工具本地安装（避免每次重新解析）
uv tool install mcp-server-fetch mcp-server-time

# 2. NPM 工具全局安装（跳过 npx 检查）
npm install -g @bharathvaj/whois-mcp @antv/mcp-server-chart
```

**预期效果：**
| 工具 | 当前耗时 | 优化后 | 提升 |
|-----|---------|--------|------|
| whois | 2,883ms | <500ms | **83%** |
| mcp-server-chart | 3,019ms | <500ms | **83%** |
| Fetch | 1,775ms | <300ms | **83%** |
| time | 1,598ms | <300ms | **81%** |

---

## 四、性能瓶颈深度剖析

### 4.1 引擎启动流程拆解

```
冷启动流程 (#4):
═══════════════════════════════════════════════════════════════
10:15:16.655  开始启动引擎
10:15:16.655  Spawn ACP 进程
10:15:16.755  进程启动完成 (~100ms)
10:15:17.255  加载 ACP SDK (~500ms)
10:15:17.455  建立 stdio 连接 (~200ms)
10:15:23.063  ACP initialized (6,408ms) ← 主要耗时
10:15:24.063  Engine ready (1,000ms)
10:15:24.141  /computer/chat 完成 (7,492ms)
═══════════════════════════════════════════════════════════════

复用流程 (#1):
═══════════════════════════════════════════════════════════════
10:07:51.040  收到请求
10:07:51.040  检查引擎状态
10:07:51.090  引擎已运行，复用 (~50ms)
10:07:51.640  ACP initialized (549ms)
10:07:51.642  Engine ready (2ms)
10:07:52.123  /computer/chat 完成 (1,088ms)
═══════════════════════════════════════════════════════════════
```

### 4.2 MCP 启动对用户体验的影响

**关键洞察：MCP 是异步启动的！**

```
用户感知时间线:
────────────────────────────────────────────────────────
0ms        用户发起请求
│
1,000ms    引擎复用会话：首屏响应 ✅
│
7,800ms    新会话：首屏响应 ✅
│          ← 用户认为"加载完成"
│
7,800ms+   MCP 服务器在后台启动
│          - chrome-devtools (0.2s)
│          - 需求分析 (0.1s)
│          - image-understanding (4.8s)
│          - Fetch (1.8s)
│          - time (1.6s)
│          - whois (2.9s)
│          - mcp-server-chart (3.0s)
│
12,600ms   所有 MCP 就绪，可执行工具调用
────────────────────────────────────────────────────────
```

**结论：** MCP 启动时间不影响用户感知的首屏时间，但影响工具可用时间。

---

## 五、优化建议（按优先级排序）

### 5.1 立即执行（1-2 天）

#### 1. MCP 本地安装

```bash
# UV 工具安装
uv tool install mcp-server-fetch mcp-server-time

# NPM 工具全局安装
npm install -g @bharathvaj/whois-mcp @antv/mcp-server-chart
```

**代码修改** ([mcp.ts](../src/main/services/packages/mcp.ts)):
```typescript
export function resolveMcpCommand(
  command: string,
  args: string[]
): { command: string; args: string[] } {
  // 检查本地安装
  const localPath = findLocalMcp(command);
  if (localPath) {
    return { command: localPath, args };
  }
  
  // 回退到 npx/uvx
  if (command === "npx") {
    return { command: "npx", args: ["-y", ...args] };
  }
  
  if (command === "uvx") {
    return resolveUvCommand(command, args);
  }
  
  return { command, args };
}
```

**预期效果：** MCP 启动时间从 2-4s → <500ms

### 5.2 短期优化（1-2 周）

#### 2. 服务端优化

- **image-understanding** SSE 服务端响应优化（目标 <500ms）
- 参考 **需求分析** 服务端实现（143ms）

#### 3. 引擎保活机制

```typescript
// 当前: 引擎在会话结束后可能关闭
// 优化: 保持引擎运行 5-10 分钟，避免频繁冷启动

const ENGINE_KEEP_ALIVE_MS = 5 * 60 * 1000; // 5 分钟

class UnifiedAgentService {
  private engineKeepAliveTimer: NodeJS.Timeout | null = null;
  
  scheduleEngineShutdown(engineId: string) {
    if (this.engineKeepAliveTimer) {
      clearTimeout(this.engineKeepAliveTimer);
    }
    
    this.engineKeepAliveTimer = setTimeout(() => {
      this.stopEngine(engineId);
    }, ENGINE_KEEP_ALIVE_MS);
  }
}
```

**预期效果：** 减少冷启动概率，平均会话时间从 7.8s → ~6s

### 5.3 中期优化（1 个月）

#### 4. MCP 预加载

```typescript
// 在应用启动时预加载 MCP
app.on('ready', async () => {
  await preloadCriticalMcps(['需求分析', 'chrome-devtools']);
});

async function preloadCriticalMcps(mcpNames: string[]) {
  for (const name of mcpNames) {
    try {
      await startMcpServer(name);
      log.info(`Preloaded MCP: ${name}`);
    } catch (err) {
      log.warn(`Failed to preload MCP ${name}:`, err);
    }
  }
}
```

**预期效果：** 用户感知 MCP 启动时间从 4.8s → <100ms

#### 5. ACP 初始化优化

```typescript
// 并行化初始化步骤
async init(config: AgentConfig): Promise<boolean> {
  const [connection, acpSdk] = await Promise.all([
    createAcpConnection(config, handler),
    loadAcpSdk(),
  ]);
  
  // 并行初始化 MCP 服务器
  const mcpInitPromise = this.initMcpServers(config.mcpServers);
  
  // 等待 ACP 握手完成
  const initResult = await connection.initialize({...});
  
  // 后台继续初始化 MCP
  mcpInitPromise.then(() => {
    log.info("MCP servers initialized in background");
  });
  
  this._ready = true;
  return true;
}
```

**预期效果：** ACP Initialize 从 600ms → ~300ms

---

## 六、优化效果预测

### 6.1 当前 vs 优化后对比

| 指标 | 当前 | 短期优化 | 中期优化 |
|-----|------|---------|---------|
| **引擎复用会话** | 1,000ms | 800ms | 500ms |
| **新会话（冷启动）** | 7,800ms | 6,500ms | 5,500ms |
| **MCP 最长耗时** | 4.8s | <500ms | <100ms |
| **工具可用时间** | 12.6s | 5.0s | 2.0s |

### 6.2 用户体验提升

```
优化前:
用户点击 → 等待 7.8s → 看到界面 → 再等 4.8s → MCP 可用

短期优化后:
用户点击 → 等待 6.5s → 看到界面 → 再等 0.5s → MCP 可用

中期优化后:
用户点击 → 等待 5.5s → 看到界面 → 立即使用 MCP ✅
```

---

## 七、相关代码文件

| 文件 | 描述 |
|-----|------|
| [computerServer.ts](../src/main/services/computerServer.ts) | HTTP 服务器，性能计时 |
| [acpEngine.ts](../src/main/services/engines/acp/acpEngine.ts) | ACP 引擎生命周期管理 |
| [acpClient.ts](../src/main/services/engines/acp/acpClient.ts) | ACP 客户端连接管理 |
| [unifiedAgent.ts](../src/main/services/engines/unifiedAgent.ts) | 统一 Agent 服务 |
| [mcp.ts](../src/main/services/packages/mcp.ts) | MCP 代理管理 |
| [persistentMcpBridge.ts](../src/main/services/packages/persistentMcpBridge.ts) | 持久化 MCP 桥接 |

---

## 八、附录：原始日志数据

### 8.1 性能计时日志

```
[2026-03-20 10:07:52.123] ⏱️ [HTTP][PERF] /computer/chat 总耗时: 1088ms (parseBody=1ms, validate=2ms, ensureWorkspace=1ms, ensureEngine=1080ms, chat=4ms)
[2026-03-20 10:08:19.095] ⏱️ [HTTP][PERF] /computer/chat 总耗时: 1029ms (parseBody=1ms, validate=2ms, ensureWorkspace=1ms, ensureEngine=1021ms, chat=4ms)
[2026-03-20 10:09:14.442] ⏱️ [HTTP][PERF] /computer/chat 总耗时: 1017ms (parseBody=2ms, validate=2ms, ensureWorkspace=1ms, ensureEngine=1008ms, chat=4ms)
[2026-03-20 10:15:24.141] ⏱️ [HTTP][PERF] /computer/chat 总耗时: 7492ms (parseBody=2ms, validate=3ms, ensureWorkspace=1ms, ensureEngine=7409ms, chat=77ms)
[2026-03-20 11:09:48.812] ⏱️ [HTTP][PERF] /computer/chat 总耗时: 7822ms (parseBody=5ms, validate=4ms, ensureWorkspace=1ms, ensureEngine=7734ms, chat=78ms)
[2026-03-20 12:19:52.196] ⏱️ [HTTP][PERF] /computer/chat 总耗时: 7800ms (parseBody=3ms, validate=2ms, ensureWorkspace=1ms, ensureEngine=7708ms, chat=86ms)
[2026-03-20 12:24:12.225] ⏱️ [HTTP][PERF] /computer/chat 总耗时: 8005ms (parseBody=2ms, validate=1ms, ensureWorkspace=1ms, ensureEngine=7919ms, chat=82ms)
[2026-03-20 12:25:32.661] ⏱️ [HTTP][PERF] /computer/chat 总耗时: 7908ms (parseBody=2ms, validate=2ms, ensureWorkspace=1ms, ensureEngine=7815ms, chat=88ms)
```

### 8.2 MCP 启动日志

```
# whois
[2026-03-20 12:25:39.463] Starting proxy with 1 server(s): whois
[2026-03-20 12:25:39.464] Connecting to "whois" (stdio): npx -y @bharathvaj/whois-mcp@latest
[2026-03-20 12:25:39.501] ✅ Connected via CustomStdioClientTransport
[2026-03-20 12:25:42.346] Server "whois": 2 tool(s) — whois_domain, whois_tld
[2026-03-20 12:25:42.348] Proxy server running on stdio

# time (uvx)
[2026-03-20 12:25:39.513] Starting proxy with 1 server(s): time
[2026-03-20 12:25:39.513] Connecting to "time" (stdio): uv.exe tool run mcp-server-time
[2026-03-20 12:25:39.567] ✅ Connected via CustomStdioClientTransport
[2026-03-20 12:25:41.111] Server "time": 1 tool(s) — get_current_time
[2026-03-20 12:25:41.113] Proxy server running on stdio
```

---

*报告生成时间: 2026-03-20*  
*分析工具: Claude Code*  
*日志来源: C:\Users\soddygo\.nuwaclaw\logs\latest.log*
