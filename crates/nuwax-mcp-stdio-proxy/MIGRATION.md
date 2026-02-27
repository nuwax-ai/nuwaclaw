# 接入替换文档：nuwax-mcp-stdio-proxy → agent-electron-client

将 `crates/agent-electron-client` 中旧的 `mcp-stdio-proxy`（bin: `mcp-proxy`，Rust 二进制）替换为新的 `nuwax-mcp-stdio-proxy`（纯 TypeScript/Node.js）。

---

## 一、旧 mcp-proxy 完整能力梳理

通过 `mcp-proxy --help` 确认，旧 Rust 二进制（v0.1.54）支持以下子命令：

| 子命令 | 方向 | 用途 |
|--------|------|------|
| `proxy` | **stdio → Streamable HTTP/SSE** | 将本地 stdio MCP server 暴露为 HTTP 服务 |
| `convert` | **Streamable HTTP/SSE → stdio** | 将远程 HTTP MCP 服务转换为本地 stdio |
| `detect` | — | 自动检测远程服务协议类型 |
| `check` | — | 检查远程服务可用性 |
| `health` | — | 健康检查（MCP 握手级别） |

### `proxy` 子命令详情

```bash
mcp-proxy proxy --port <PORT> --host <HOST> --config '<mcpServers JSON>'
                [--protocol sse|stream]   # 默认 stream (Streamable HTTP)
                [--log-dir <DIR>]
                [--diagnostic]
```

- 启动 HTTP 服务器，聚合 `--config` 中定义的 stdio MCP servers
- 对外暴露 Streamable HTTP（默认）或 SSE 端点
- 支持 `--allow-tools` / `--deny-tools` 工具过滤

### `convert` 子命令详情

```bash
mcp-proxy convert <URL>
                  [--config '<mcpServers JSON>']  # 也支持 config 模式
                  [--auth "Bearer token"]
                  [--protocol sse|stream]
                  [--ping-interval <SEC>]
```

- 将远程 HTTP/SSE MCP 服务转为本地 stdio 接口
- Agent 引擎（claude-code / nuwaxcode）通过 stdio 消费

---

## 二、Tauri 客户端实际架构（参考基准）

Tauri 客户端使用的是 **stdio → Streamable HTTP → stdio** 双跳架构：

```
┌─ Tauri Main Process ─────────────────────────────────────────────┐
│                                                                   │
│  1. 启动 proxy 进程:                                              │
│     mcp-proxy proxy --port 18099 --host 127.0.0.1                │
│                     --config '{"mcpServers":{...}}'              │
│                     --protocol stream                             │
│                                                                   │
│  2. TCP 健康检查:                                                 │
│     wait_for_mcp_proxy_ready(18099, "127.0.0.1", timeout=15s)    │
│                                                                   │
│  3. 注入 Agent MCP 配置:                                          │
│     { "mcp-proxy": {                                              │
│         "command": "mcp-proxy",                                   │
│         "args": ["convert", "http://127.0.0.1:18099"]            │
│     }}                                                            │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘

数据流:

Child MCP Servers (stdio × N)
    ↑ StdioClientTransport
    │
mcp-proxy proxy (Rust, 聚合 + Streamable HTTP 服务器)
    │ http://127.0.0.1:18099
    ↓
mcp-proxy convert http://127.0.0.1:18099 (Rust, HTTP → stdio)
    │ stdio
    ↓
Agent Engine (claude-code / nuwaxcode)
```

**Tauri 这样做的原因**：
- Rust 原生 `Command::new()` + `CREATE_NO_WINDOW` 避免 Windows 弹窗
- 进程组管理（Unix: setsid, Windows: JobObject）
- TCP 健康检查确认服务就绪

**存在的问题**：
- 需要端口管理（默认 18099，冲突时需要 kill 旧进程）
- 两层 mcp-proxy 进程（proxy + convert）
- Electron 客户端复用此架构时，Rust 二进制 + `.cmd` wrapper 导致 Windows 弹窗

---

## 三、Electron 客户端当前架构（有问题）

Electron 当前**试图复制** Tauri 架构，但有几个问题：

```
Electron Main Process
  │ spawnJsFile() → run-mcp-proxy.js → Rust binary
  │   mcp-proxy proxy --port 8080 --host 127.0.0.1 --config '...'
  ▼
mcp-proxy proxy (Rust binary, HTTP server)
  │ http://127.0.0.1:8080
  ▼
Agent Engine
  │ mcpServers: { "mcp-proxy": { command: "mcp-proxy", args: ["convert", "http://..."] } }
  ▼
mcp-proxy convert (Rust binary, HTTP → stdio)
```

**问题清单**：
1. Windows 上 Rust 二进制 `.cmd` wrapper 弹出控制台窗口
2. `spawnJsFile()` spawn 的是 `run-mcp-proxy.js`（Node.js wrapper），它下载并执行 Rust binary
3. 端口管理复杂（分配、占用检测、kill 占用进程）
4. 单进程限制（Electron 代码中强制过滤为单服务）
5. 两层进程开销

---

## 四、新架构设计

### 方案：纯 stdio 直通（消除 HTTP 中间层）

```
Agent Engine (claude-code / nuwaxcode)
  │ spawns as MCP server (stdio)
  ▼
nuwax-mcp-stdio-proxy --config '{"mcpServers":{...}}'
  │ StdioServerTransport (上游) + StdioClientTransport × N (下游)
  ▼
Child MCP Servers (stdio × N)
```

**核心变化**：
- **消除 HTTP 中间层**：不再需要 `proxy` → HTTP → `convert` 的双跳
- **Agent 直接 spawn proxy**：proxy 是 Agent 引擎的一个 stdio MCP server
- **Electron 不管理 proxy 进程**：生命周期随 Agent 引擎
- **纯 Node.js**：无 Rust 二进制，无 `.cmd` wrapper，Windows 无弹窗

### 架构对比

| | Tauri（旧） | Electron 旧 | Electron 新 |
|---|---|---|---|
| **聚合层** | `mcp-proxy proxy` (Rust, HTTP) | 同左 | `nuwax-mcp-stdio-proxy` (Node.js, stdio) |
| **桥接层** | `mcp-proxy convert` (Rust, HTTP→stdio) | 同左 | **无**（直接 stdio） |
| **进程数** | 2 (proxy + convert) | 2 | 1 |
| **通信协议** | stdio → HTTP → stdio | 同左 | stdio → stdio |
| **端口** | 需要 (18099) | 需要 (8080) | **无** |
| **Windows 弹窗** | 无（Rust CREATE_NO_WINDOW） | **有**（.cmd wrapper） | **无**（Node.js） |
| **多服务** | 支持 | 强制单服务 | 支持 N 个 |
| **生命周期** | Tauri 管理 | Electron 管理 | Agent 引擎管理 |

### 为什么可以省掉 HTTP 层

旧架构需要 HTTP 中间层是因为：
- Tauri 的 Rust 进程管理需要一个长驻 HTTP 服务作为控制面
- Agent 引擎通过 `mcp-proxy convert <url>` 以 stdio 方式接入

新架构中：
- `nuwax-mcp-stdio-proxy` 本身就是一个 stdio MCP server
- Agent 引擎直接 spawn 它，无需中转
- 配置通过 `--config` 参数传入，无需运行时控制面

---

## 五、配置格式兼容性

新旧 proxy 使用**完全相同**的 `mcpServers` JSON 配置格式：

```typescript
interface McpServersConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}
```

- SQLite 中持久化的 `mcp_proxy_config` 键值可直接复用
- `resolveServersConfig()` 的 uvx 解析和 env 注入逻辑不变

---

## 六、需要修改的文件清单

| # | 文件 | 改动量 | 说明 |
|---|------|--------|------|
| 1 | `src/main/services/packages/mcp.ts` | **大改** | 核心：移除 HTTP 进程管理，改为配置提供者 |
| 2 | `src/main/services/system/dependencies.ts` | 小改 | 更新包名、bin 名、最低版本 |
| 3 | `src/main/ipc/mcpHandlers.ts` | 中改 | 简化 start/stop/restart 为 no-op |
| 4 | `src/main/ipc/processHandlers.ts` | 中改 | restartAll/stopAll 移除 MCP 进程管理 |
| 5 | `src/main/main.ts` | 小改 | cleanup 中移除 mcpProxyManager.cleanup() |
| 6 | `src/renderer/App.tsx` | 中改 | 移除 mcpProxy 进程启动/轮询 |
| 7 | `src/renderer/components/ClientPage.tsx` | 中改 | 移除 mcpProxy 启停逻辑 |
| 8 | `src/renderer/components/MCPSettings.tsx` | 小改 | 移除端口配置 UI |
| 9 | `src/main/services/engines/unifiedAgent.ts` | 无改 | syncMcpConfigToProxyAndReload 已简化 |
| 10 | `src/main/ipc/agentHandlers.ts` | 无改 | getAgentMcpConfig() 返回值已变 |

---

## 七、逐文件改动详解

### 7.1 `src/main/services/packages/mcp.ts` — 核心重构

旧文件约 692 行，重构后预计约 300 行。

#### 7.1.1 删除的代码（约 400 行）

| 删除项 | 原因 |
|--------|------|
| `import { spawn, ChildProcess, exec }` | 不再 spawn 进程 |
| `import * as net` | 不再管理端口 |
| `import { DEFAULT_MCP_PROXY_PORT, DEFAULT_MCP_PROXY_HOST }` | 不再使用端口/主机 |
| `isPortInUse()` 函数 | 不再管理端口 |
| `killProcessOnPort()` 函数 | 不再管理端口 |
| `McpProxyManager.process` / `.port` / `.host` / `.startPromise` 字段 | 无进程实例 |
| `McpProxyManager.start()` 方法体（进程 spawn 逻辑） | 整体重写为验证 |
| `McpProxyManager.stop()` / `.restart()` 方法体 | 简化为 no-op |
| `McpProxyManager.isProcessRunning()` | 无进程 |
| `McpProxyManager.getPort()` / `.setPort()` | 不再使用端口 |
| `McpProxyManager.cleanup()` 方法体 | 简化为 no-op |
| `McpProxyStatus.pid` / `.port` / `.host` 字段 | 不再使用 |
| `McpProxyStartConfig` 接口 | 不再使用 |
| `extractRealServersFromMcpServers()` 中解析 `mcp-proxy convert` 桥接项 | 无桥接模式 |

#### 7.1.2 保留的代码（约 200 行）

| 保留项 | 说明 |
|--------|------|
| `getUvBinDir()` / `resolveUvCommand()` | 仍需为 child server 解析 uvx |
| `resolveServersConfig()` | 仍需注入 env + 解析 uvx |
| `DEFAULT_MCP_PROXY_CONFIG` | 默认配置不变 |
| `McpServerEntry` / `McpServersConfig` 接口 | 配置格式不变 |
| `McpProxyManager.config` + get/set/add/remove | 配置管理不变 |
| `syncMcpConfigToProxyAndReload()` | 保留但简化（不 restart） |

#### 7.1.3 `McpProxyManager` 类重写

```typescript
class McpProxyManager {
  private config: McpServersConfig = JSON.parse(JSON.stringify(DEFAULT_MCP_PROXY_CONFIG));

  /**
   * 获取 nuwax-mcp-stdio-proxy 脚本路径
   */
  private getProxyScriptPath(): string | null {
    const dirs = getAppPaths();
    const packageDir = path.join(dirs.nodeModules, 'nuwax-mcp-stdio-proxy');
    if (!fs.existsSync(packageDir)) return null;
    return resolveNpmPackageEntry(packageDir, 'nuwax-mcp-stdio-proxy');
  }

  /**
   * start() → 仅验证 binary 可用性（不再启动进程）
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    if (!isInstalledLocally('nuwax-mcp-stdio-proxy')) {
      return { success: false, error: 'nuwax-mcp-stdio-proxy 未安装' };
    }
    const scriptPath = this.getProxyScriptPath();
    if (!scriptPath) {
      return { success: false, error: 'nuwax-mcp-stdio-proxy 入口文件未找到' };
    }
    log.info('[McpProxy] nuwax-mcp-stdio-proxy 就绪:', scriptPath);
    return { success: true };
  }

  async stop(): Promise<{ success: boolean }> { return { success: true }; }
  async restart(): Promise<{ success: boolean; error?: string }> { return this.start(); }

  getStatus(): McpProxyStatus {
    const serverNames = Object.keys(this.config.mcpServers || {});
    return {
      running: !!this.getProxyScriptPath(),
      serverCount: serverNames.length,
      serverNames,
    };
  }

  /**
   * getAgentMcpConfig() — 核心变更
   *
   * 旧: 返回 { "mcp-proxy": { command: "mcp-proxy", args: ["convert", "http://127.0.0.1:8080"] } }
   * 新: 返回 { "mcp-proxy": { command: "node", args: ["proxy.js", "--config", "..."] } }
   *
   * Agent 引擎直接 spawn nuwax-mcp-stdio-proxy 作为 stdio MCP server，
   * 不再经过 HTTP 中间层。
   */
  getAgentMcpConfig(): Record<string, {
    command: string; args: string[]; env?: Record<string, string>;
  }> | null {
    const servers = this.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) return null;

    const scriptPath = this.getProxyScriptPath();
    if (!scriptPath) {
      // fallback: 直接返回解析后的各 server stdio 配置（无聚合）
      return resolveServersConfig(servers);
    }

    // 解析配置：uvx → 应用内路径，注入 env
    const resolvedConfig: McpServersConfig = {
      mcpServers: resolveServersConfig(servers),
    };
    const configJson = JSON.stringify(resolvedConfig);

    // Windows: 用 Electron 的 Node.js 执行（避免 .cmd 弹窗）
    // macOS/Linux: 用系统 node
    if (isWindows()) {
      return {
        'mcp-proxy': {
          command: process.execPath,
          args: [scriptPath, '--config', configJson],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      };
    }

    return {
      'mcp-proxy': {
        command: 'node',
        args: [scriptPath, '--config', configJson],
      },
    };
  }

  cleanup(): void { /* no-op */ }

  // getConfig / setConfig / addServer / removeServer — 保持不变
}
```

#### 7.1.4 `McpProxyStatus` 接口简化

```typescript
// 旧
export interface McpProxyStatus {
  running: boolean;
  pid?: number;       // ← 删除
  port?: number;      // ← 删除
  host?: string;      // ← 删除
  serverCount?: number;
  serverNames?: string[];
}

// 新
export interface McpProxyStatus {
  running: boolean;    // 语义变化："binary 可用" 而非 "进程在运行"
  serverCount?: number;
  serverNames?: string[];
}
```

#### 7.1.5 `syncMcpConfigToProxyAndReload()` 简化

```typescript
export async function syncMcpConfigToProxyAndReload(
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Promise<void> {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return;

  // 提取真实服务（过滤旧桥接项 command==='mcp-proxy'）
  const realOnly: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (!entry || entry.command === 'mcp-proxy') continue;
    realOnly[name] = { command: entry.command, args: Array.isArray(entry.args) ? entry.args : [], env: entry.env };
  }
  if (Object.keys(realOnly).length === 0) return;

  log.info('[McpProxy] 同步 MCP 配置:', Object.keys(realOnly).join(', '));
  mcpProxyManager.setConfig({ mcpServers: realOnly });

  // 持久化到 SQLite
  try {
    const { getDb } = await import('../../db');
    const db = getDb();
    db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('mcp_proxy_config', JSON.stringify({ mcpServers: realOnly }));
  } catch (e) {
    log.warn('[McpProxy] 持久化 MCP 配置失败:', e);
  }

  // 不再需要 restart — 无后台进程
  // Agent 下次 init 时 getAgentMcpConfig() 会使用新配置
}
```

---

### 7.2 `src/main/services/system/dependencies.ts`

**改动 1**：`SETUP_REQUIRED_DEPENDENCIES` 中更新 MCP 条目

```typescript
// 旧
{
  name: "mcp-stdio-proxy",
  displayName: "MCP 服务",
  type: "npm-local",
  description: "MCP 协议转换工具（应用内安装）",
  required: true,
  minVersion: "0.1.48",
  binName: "mcp-proxy",
},

// 新
{
  name: "nuwax-mcp-stdio-proxy",
  displayName: "MCP 服务",
  type: "npm-local",
  description: "MCP 协议聚合代理（应用内安装）",
  required: true,
  minVersion: "1.0.0",
  binName: "nuwax-mcp-stdio-proxy",
},
```

**改动 2**：`checkAllDependencies()` 中更新 case

```diff
- case 'mcp-stdio-proxy':
+ case 'nuwax-mcp-stdio-proxy':
```

---

### 7.3 `src/main/ipc/mcpHandlers.ts`

- `mcp:start` → 移除 options 参数（port/host/configJson），调用 `mcpProxyManager.start()`（仅验证）
- `mcp:stop` → 调用 `mcpProxyManager.stop()`（no-op）
- `mcp:restart` → 调用 `mcpProxyManager.restart()`（仅验证）
- `mcp:getPort` / `mcp:setPort` → 保留为 no-op 向后兼容
- `mcp:getConfig` / `mcp:setConfig` → 不变

---

### 7.4 `src/main/ipc/processHandlers.ts`

`services:restartAll`:
- 移除 `mcpProxyManager.stop()` 调用
- `mcpProxyManager.start()` 保留但语义变为"验证可用性"

`services:stopAll`:
- MCP Proxy 部分改为 `results.mcpProxy = { success: true }` (no-op)

---

### 7.5 `src/main/main.ts`

`cleanupAllProcesses()` 中移除或注释 `mcpProxyManager.cleanup()`（已 no-op）。

---

### 7.6 `src/renderer/App.tsx` + `ClientPage.tsx`

`mcpProxy` 在 serviceKeys/startOrder 中**保留**，因为 `mcp.start()` 已变为轻量验证。UI 展示的 `running` 状态语义从"进程运行中"变为"binary 可用"。

可选移除 `pid` 字段的展示。

---

### 7.7 `src/renderer/components/MCPSettings.tsx`

- 移除端口配置 UI（不再使用端口）
- 启动/停止按钮可保留（已为 no-op）或改为"检测可用性"
- MCP server 列表编辑功能保留不变

---

## 八、关键行为变更对照表

| 行为 | 旧（mcp-proxy Rust） | 新（nuwax-mcp-stdio-proxy TS） |
|------|----------------------|-------------------------------|
| **binary 类型** | Rust 编译二进制 | Node.js 脚本 |
| **通信链路** | stdio → HTTP (Streamable) → stdio | stdio → stdio |
| **进程数** | 2 (proxy + convert) | 1 |
| **端口** | 需要（默认 8080/18099） | **无** |
| **进程管理** | Electron spawn + 监控 + cleanup | Agent 引擎自动管理 |
| **多服务聚合** | 支持（但 Electron 强制单服务） | 支持 N 个 |
| **Agent 注入** | `mcp-proxy convert http://...` | `node proxy.js --config '...'` |
| **Windows 弹窗** | 有（.cmd wrapper） | **无**（Node.js + ELECTRON_RUN_AS_NODE） |
| **配置热更新** | restart proxy HTTP 进程 | 更新配置，Agent 下次 init 使用 |
| **健康检查** | TCP 连接测试 | 不需要（无 HTTP 服务） |
| **远程 MCP 服务** | 支持（convert URL → stdio） | 不支持（仅聚合本地 stdio servers） |

### 注意：远程 MCP 服务能力

旧 `mcp-proxy` 的 `convert` 子命令支持将远程 SSE/Streamable HTTP MCP 服务转为 stdio。新的 `nuwax-mcp-stdio-proxy` 仅支持聚合本地 stdio servers。

如果需要访问远程 MCP 服务，有两个选项：
1. **保留旧 `mcp-proxy` 作为 convert 工具**：远程服务配置为 `{ command: "mcp-proxy", args: ["convert", "https://..."] }`，作为 `nuwax-mcp-stdio-proxy` 的一个 child server
2. **后续为 nuwax-mcp-stdio-proxy 添加 HTTP client transport**

---

## 九、实施步骤

### Phase 1: 发布 npm 包

```bash
cd crates/nuwax-mcp-stdio-proxy
npm run build
npm publish
```

### Phase 2: 修改 Electron 客户端

按以下顺序修改（每步可独立提交）：

1. `dependencies.ts` — 更新包名/bin 名/版本
2. `mcp.ts` — 核心重构
3. `mcpHandlers.ts` — 简化 IPC
4. `processHandlers.ts` — 移除 MCP 进程管理
5. `main.ts` — 移除 cleanup
6. `App.tsx` + `ClientPage.tsx` — UI 适配
7. `MCPSettings.tsx` — 移除端口配置

### Phase 3: 测试验证

- [ ] 初始化向导自动安装 `nuwax-mcp-stdio-proxy`
- [ ] `getAgentMcpConfig()` 返回 `{ command: "node", args: ["proxy.js", "--config", "..."] }`
- [ ] Agent 通过 proxy 聚合多个 MCP server 的 tools
- [ ] Windows 上无控制台弹窗
- [ ] macOS/Linux 上功能正常
- [ ] MCP 设置页可编辑 server 列表
- [ ] 配置修改后 Agent 重新 init 生效
- [ ] 远程 MCP 服务可通过 `mcp-proxy convert` 作为 child server 接入

---

## 十、回滚方案

若需回滚到旧 `mcp-proxy`：

1. `dependencies.ts` 改回 `name: "mcp-stdio-proxy"`, `binName: "mcp-proxy"`
2. `mcp.ts` 恢复进程管理逻辑
3. 重新安装 `npm install mcp-stdio-proxy`

配置格式完全兼容，SQLite 数据无需迁移。

---

## 十一、共享类型更新

如果 `@shared/types/electron.ts` 导出了 `McpProxyStatus`，需同步移除 `pid` / `port` / `host` 字段：

```typescript
export interface McpProxyStatus {
  running: boolean;
  serverCount?: number;
  serverNames?: string[];
}
```

同时删除 `McpProxyStartConfig` 接口。
