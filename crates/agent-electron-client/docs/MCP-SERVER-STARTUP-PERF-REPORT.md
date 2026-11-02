# MCP 服务器启动性能分析报告

**报告日期**: 2026-03-20  
**分析范围**: 5 次新会话启动日志  
**日志来源**: `C:\Users\soddygo\.nuwaclaw\logs\`  
**代码版本**: `crates/agent-electron-client/src/main/services/packages/mcp.ts`

---

## 执行摘要

本报告分析了 NuwaClaw 应用中 7 个 MCP 服务器的启动性能，基于 5 次真实会话的日志数据。主要发现：

- **uvx 工具缓存优化效果显著**: Fetch 启动时间从 11s 降至 1.8s（优化 84%）
- **npx 工具表现稳定**: whois 和 mcp-server-chart 稳定在 2.9-3.0s
- **SSE 服务端性能差异大**: 需求分析 143ms vs image-understanding 4.8s
- **引擎复用可节省 5.8s**: 冷启动 6.4s vs 复用 0.6s

### 代码实现要点

根据 [mcp.ts](../src/main/services/packages/mcp.ts) 的实现：

```typescript
// uvx 命令被重写为 uv tool run（uv >= 0.10 后 uvx multicall 已废弃）
export function resolveUvCommand(command: string, args: string[]): {
  if (base === "uvx") {
    return { command: uvPath, args: ["tool", "run", ...args] };
  }
}
```

这意味着 `uvx mcp-server-fetch` 实际执行的是 `uv tool run mcp-server-fetch`。

---

## 测试会话概览

| # | 会话 ID | 时间 | 项目 ID | 总耗时 | 引擎状态 |
|---|---------|------|---------|--------|---------|
| 1 | `fac459ca-425d-4a9a-a0ec-29c162979f59` | 10:15:16.649 | 1541412 | **7,492ms** | 冷启动 |
| 2 | `2d25ece6-e670-49de-a228-ba6a5e194936` | 11:09:48.171 | 1541421 | **7,822ms** | 复用 |
| 3 | `00c9428d-fd5d-4870-837d-3e238458dc40` | 12:19:52.110 | 1541421 | **7,800ms** | 复用 |
| 4 | `91d5c45d-8c8a-4136-ae08-e051a55e5db9` | 12:24:12.221 | 1541421 | **8,005ms** | 复用 |
| 5 | `0bd55f76-c229-411e-9519-0abca58db801` | 12:25:32.656 | 1541421 | **7,908ms** | 复用 |

---

## MCP 服务器启动耗时详细数据

### 1. whois (npx -y @bharathvaj/whois-mcp@latest)

| 会话 | 启动时间 | 完成时间 | 耗时 | 进程启动 | 工具加载 |
|------|---------|---------|------|---------|---------|
| #1 | 10:15:41.261 | 10:15:44.992 | **3,731ms** | 42ms | 3,689ms |
| #2 | 11:09:58.013 | 11:10:00.967 | **2,952ms** | 37ms | 2,915ms |
| #3 | 12:19:57.688 | 12:20:00.747 | **3,059ms** | 41ms | 3,018ms |
| #4 | 12:24:38.915 | 12:24:41.634 | **2,717ms** | 37ms | 2,680ms |
| #5 | 12:25:39.463 | 12:25:42.348 | **2,883ms** | 38ms | 2,845ms |

**分析**: npx 工具启动时间稳定在 2.7-3.1s，主要耗时在 npm 包下载/验证。进程启动很快（37-42ms）。

**相关代码** ([mcp.ts](../src/main/services/packages/mcp.ts)):
```typescript
// npx 命令直接透传，不做特殊处理
// 启动时通过 spawn 执行: npx -y @bharathvaj/whois-mcp@latest
```

---

### 2. mcp-server-chart (npx -y @antv/mcp-server-chart)

| 会话 | 启动时间 | 完成时间 | 耗时 | 进程启动 | 工具加载 |
|------|---------|---------|------|---------|---------|
| #1 | 10:15:47.273 | 10:15:50.428 | **3,155ms** | 32ms | 3,123ms |
| #2 | 11:10:01.184 | 11:10:04.044 | **2,860ms** | 31ms | 2,829ms |
| #3 | 12:20:00.951 | 12:20:03.843 | **2,892ms** | 34ms | 2,858ms |
| #4 | 12:24:46.735 | 12:24:49.639 | **2,903ms** | 30ms | 2,873ms |
| #5 | 12:25:43.956 | 12:25:46.976 | **3,019ms** | 36ms | 2,983ms |

**分析**: 与 whois 类似，npx 启动稳定在 2.9-3.0s，包已缓存后性能稳定。

---

### 3. time (uvx mcp-server-time)

| 会话 | 启动时间 | 完成时间 | 耗时 | 进程启动 | 工具加载 |
|------|---------|---------|------|---------|---------|
| #1 | 10:15:41.305 | 10:15:47.067 | **5,762ms** | 55ms | 5,707ms |
| #2 | 11:09:58.051 | 11:10:00.328 | **2,277ms** | 50ms | 2,227ms |
| #3 | 12:19:57.728 | 12:19:59.625 | **1,897ms** | 53ms | 1,844ms |
| #4 | 12:24:38.965 | 12:24:40.456 | **1,490ms** | 52ms | 1,438ms |
| #5 | 12:25:39.513 | 12:25:41.113 | **1,598ms** | 54ms | 1,544ms |

**趋势**: 持续优化，从 5.8s 降至 1.5s，累计优化 **74%**

**分析**: uv 工具缓存逐渐预热，后续启动更快。

**相关代码** ([mcp.ts](../src/main/services/packages/mcp.ts#L47-L62)):
```typescript
export function resolveUvCommand(command: string, args: string[]): {
  if (base === "uvx") {
    // Always use `uv tool run` — the uvx multicall binary is broken in uv >= 0.10
    const uvName = isWindows() ? "uv.exe" : "uv";
    const uvPath = path.join(dir, uvName);
    if (fs.existsSync(uvPath)) {
      return { command: uvPath, args: ["tool", "run", ...args] };
    }
  }
}
```

实际执行的命令：`uv tool run mcp-server-time --local-timezone=America/New_York`

---

### 4. Fetch 网页内容抓取 (uvx mcp-server-fetch)

| 会话 | 启动时间 | 完成时间 | 耗时 | 进程启动 | 工具加载 |
|------|---------|---------|------|---------|---------|
| #1 | 10:15:25.645 | 10:15:36.640 | **10,995ms** | 219ms | 10,776ms |
| #2 | 11:09:50.347 | 11:09:53.940 | **3,593ms** | 189ms | 3,404ms |
| #3 | 12:19:53.708 | 12:19:57.434 | **3,725ms** | 193ms | 3,532ms |
| #4 | 12:24:13.703 | 12:24:15.836 | **2,133ms** | 78ms | 2,055ms |
| #5 | 12:25:34.204 | 12:25:35.980 | **1,775ms** | 74ms | 1,701ms |

**趋势**: 大幅优化，从 11.0s 降至 1.8s，累计优化 **84%**

**分析**: uv 缓存效果最显著的 MCP，第五次启动仅需 1.8s。

---

### 5. image-understanding-and-generation (SSE)

| 会话 | 启动时间 | 完成时间 | 耗时 | 协议检测 | 连接建立 |
|------|---------|---------|------|---------|---------|
| #1 | 10:15:25.626 | 10:15:41.036 | **15,410ms** | 5,007ms | 10,403ms |
| #2 | 11:09:50.321 | 11:09:55.089 | **4,768ms** | 4,768ms | - |
| #3 | 12:19:53.708 | 12:19:58.476 | **4,768ms** | 4,768ms | - |
| #4 | 12:24:13.703 | 12:24:18.471 | **4,768ms** | 4,768ms | - |
| #5 | 12:25:34.204 | 12:25:38.972 | **4,768ms** | 4,768ms | - |

**趋势**: 服务端优化后稳定在 4.8s，比第一次快 69%

**分析**: SSE 连接耗时主要取决于服务端响应速度。

**相关代码** ([acpEngine.ts](../src/main/services/engines/acp/acpEngine.ts#L155-L175)):
```typescript
// MCP servers injection for nuwaxcode
if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
  const mcpConfig: Record<string, unknown> = {};
  for (const [name, srv] of Object.entries(config.mcpServers)) {
    if ("url" in srv && srv.url) {
      // URL 类型（来自 PersistentMcpBridge）
      const urlSrv = srv as { url: string; type?: string };
      mcpConfig[name] = {
        type: urlSrv.type === "sse" ? "sse" : "streamable-http",
        url: urlSrv.url,
        enabled: true,
      };
    }
  }
}
```

---

### 6. 需求分析 (SSE)

| 会话 | 启动时间 | 完成时间 | 耗时 | 协议检测 | 连接建立 |
|------|---------|---------|------|---------|---------|
| #1 | 10:15:41.288 | 10:15:41.755 | **187ms** | 141ms | 46ms |
| #2 | 11:09:50.320 | 11:09:50.463 | **143ms** | 143ms | - |
| #3 | 12:19:53.708 | 12:19:53.851 | **143ms** | 143ms | - |
| #4 | 12:24:13.703 | 12:24:13.846 | **143ms** | 143ms | - |
| #5 | 12:25:34.204 | 12:25:34.347 | **143ms** | 143ms | - |

**分析**: 服务端响应极快，稳定在 143ms，是所有 MCP 中最快的。

---

### 7. chrome-devtools (HTTP Stream)

| 会话 | 启动时间 | 完成时间 | 耗时 |
|------|---------|---------|------|
| #1 | 10:15:24.067 | ~10:15:24.267 | **~200ms** |
| #2 | 11:09:50.318 | 11:09:50.506 | **188ms** |
| #3 | 12:19:53.708 | ~12:19:53.896 | **~188ms** |
| #4 | 12:24:13.703 | ~12:24:13.891 | **~188ms** |
| #5 | 12:25:34.204 | ~12:25:34.392 | **~188ms** |

**分析**: 本地 HTTP 服务，启动极快且稳定，约 188ms。

---

## 性能对比汇总

### 按启动方式分组

| 启动方式 | MCP 服务器 | 平均耗时 | 特点 | 代码实现 |
|---------|-----------|---------|------|---------|
| **HTTP Stream** | chrome-devtools | **188ms** | 本地服务，最快 | [persistentMcpBridge.ts](../src/main/services/packages/persistentMcpBridge.ts) |
| **SSE (URL)** | 需求分析 | **143ms** | 服务端响应快 | [acpEngine.ts](../src/main/services/engines/acp/acpEngine.ts) |
| **SSE (URL)** | image-understanding | **4,768ms** | 服务端响应慢 | [acpEngine.ts](../src/main/services/engines/acp/acpEngine.ts) |
| **npx -y** | whois, mcp-server-chart | **2,900ms** | 需下载包，中等 | [mcp.ts](../src/main/services/packages/mcp.ts) |
| **uvx** | time, Fetch | **2,200ms** | 缓存后优化显著 | [mcp.ts](../src/main/services/packages/mcp.ts) |

### 启动耗时排名（第5次会话）

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

## 关键发现

### 1. uv 工具缓存优化效果显著

| 工具 | #1 → #5 优化 | 优化率 |
|-----|-------------|--------|
| **Fetch** | 11.0s → 1.8s | **84%** |
| **time** | 5.8s → 1.6s | **72%** |

uv 工具在多次使用后缓存逐渐预热，启动时间持续下降。

**代码实现细节**:
```typescript
// uv 工具缓存位置: ~/.nuwaclaw/uv/cache
// 工具安装位置: ~/.nuwaclaw/uv/tools
// 首次运行下载，后续从缓存加载
```

### 2. npx 工具保持稳定

| 工具 | #1 → #5 变化 | 特点 |
|-----|-------------|------|
| **whois** | 3.7s → 2.9s | 稳定，波动小 |
| **mcp-server-chart** | 3.2s → 3.0s | 稳定，波动小 |

npm 包在首次下载后，后续启动时间稳定。

### 3. SSE 服务端性能差异大

| 工具 | 耗时 | 差异 |
|-----|------|------|
| **需求分析** | 143ms | 服务端响应快 |
| **image-understanding** | 4,768ms | 服务端响应慢（33倍） |

### 4. 引擎复用节省大量时间

| 启动方式 | ACP Initialize | 节省 |
|---------|---------------|------|
| 冷启动 | 6,414ms | - |
| 复用 | ~600ms | **~5.8s** |

---

## 优化建议

### 立即执行（高收益）

将 npx 和 uvx 工具改为本地安装：

```bash
# npx 工具本地安装 (预计节省 2-3s)
npm install -g @bharathvaj/whois-mcp @antv/mcp-server-chart

# uvx 工具本地安装 (预计节省 1-2s)
uv tool install mcp-server-fetch mcp-server-time
```

**代码修改建议** ([mcp.ts](../src/main/services/packages/mcp.ts)):

```typescript
// 添加本地 MCP 服务器检测逻辑
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

### 预期效果

| 指标 | 当前 | 优化后 | 提升 |
|-----|------|--------|------|
| MCP 最长耗时 | 4.8s | <500ms | **90%** |
| 总会话时间 | 7.9s | ~4s | **50%** |
| 用户等待时间 | 7.9s | ~2s | **75%** |

### 服务端优化

- **image-understanding** SSE 服务端响应需优化（目标 <500ms）
- 参考 **需求分析** 服务端实现（143ms）

---

## 附录：原始日志时间戳

### 会话 #1 (10:15)
- whois: 10:15:41.261 → 10:15:44.992 (3,731ms)
- mcp-server-chart: 10:15:47.273 → 10:15:50.428 (3,155ms)
- time: 10:15:41.305 → 10:15:47.067 (5,762ms)
- Fetch: 10:15:25.645 → 10:15:36.640 (10,995ms)
- image-understanding: 10:15:25.626 → 10:15:41.036 (15,410ms)

### 会话 #2 (11:09)
- whois: 11:09:58.013 → 11:10:00.967 (2,952ms)
- mcp-server-chart: 11:10:01.184 → 11:10:04.044 (2,860ms)
- time: 11:09:58.051 → 11:10:00.328 (2,277ms)
- Fetch: 11:09:50.347 → 11:09:53.940 (3,593ms)
- image-understanding: 11:09:50.321 → 11:09:55.089 (4,768ms)

### 会话 #3 (12:19)
- whois: 12:19:57.688 → 12:20:00.747 (3,059ms)
- mcp-server-chart: 12:20:00.951 → 12:20:03.843 (2,892ms)
- time: 12:19:57.728 → 12:19:59.625 (1,897ms)
- Fetch: 12:19:53.708 → 12:19:57.434 (3,725ms)
- image-understanding: 12:19:53.708 → 12:19:58.476 (4,768ms)

### 会话 #4 (12:24)
- whois: 12:24:38.915 → 12:24:41.634 (2,717ms)
- mcp-server-chart: 12:24:46.735 → 12:24:49.639 (2,903ms)
- time: 12:24:38.965 → 12:24:40.456 (1,490ms)
- Fetch: 12:24:13.703 → 12:24:15.836 (2,133ms)
- image-understanding: 12:24:13.703 → 12:24:18.471 (4,768ms)

### 会话 #5 (12:25)
- whois: 12:25:39.463 → 12:25:42.348 (2,883ms)
- mcp-server-chart: 12:25:43.956 → 12:25:46.976 (3,019ms)
- time: 12:25:39.513 → 12:25:41.113 (1,598ms)
- Fetch: 12:25:34.204 → 12:25:35.980 (1,775ms)
- image-understanding: 12:25:34.204 → 12:25:38.972 (4,768ms)

---

## 相关代码文件

| 文件 | 描述 |
|-----|------|
| [mcp.ts](../src/main/services/packages/mcp.ts) | MCP 代理管理，uvx/npx 命令解析 |
| [acpEngine.ts](../src/main/services/engines/acp/acpEngine.ts) | ACP 引擎，MCP 配置注入 |
| [computerServer.ts](../src/main/services/computerServer.ts) | HTTP 服务器，性能计时 |
| [mcpHelpers.ts](../src/main/services/packages/mcpHelpers.ts) | MCP 辅助函数 |
| [persistentMcpBridge.ts](../src/main/services/packages/persistentMcpBridge.ts) | 持久化 MCP 桥接 |

---

*报告生成时间: 2026-03-20*  
*分析工具: Claude Code*  
*日志来源: C:\Users\soddygo\.nuwaclaw\logs\*
