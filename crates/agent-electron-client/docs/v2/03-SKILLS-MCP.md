---
version: 2.0
last-updated: 2026-03-09
status: design
---

# 03 — Skills & MCP 工具管理

## 一、现状分析

### Nuwax 服务端已有能力

技能管理 API（`workspace/nuwax/src/services/skill.ts`）：

| 端点                             | 能力           |
| -------------------------------- | -------------- |
| `GET  /api/skill/{id}`           | 查询技能详情   |
| `POST /api/skill/update`         | 修改技能       |
| `POST /api/skill/import`         | 导入技能       |
| `GET  /api/skill/export/{id}`    | 导出技能       |
| `POST /api/skill/upload-file`    | 上传文件到技能 |
| `GET  /api/skill/template`       | 查询技能模板   |
| `POST /api/published/skill/list` | 已发布技能列表 |

MCP 管理 API（`workspace/nuwax/src/services/mcp.ts`）：

| 端点                                       | 能力            |
| ------------------------------------------ | --------------- |
| `POST /api/mcp/create`                     | 创建 MCP 服务   |
| `POST /api/mcp/update`                     | 更新 MCP 服务   |
| `POST /api/mcp/test`                       | MCP 试运行      |
| `POST /api/mcp/stop/{id}`                  | 停用 MCP        |
| `GET  /api/mcp/{id}`                       | MCP 详情        |
| `GET  /api/mcp/list/{spaceId}`             | MCP 管理列表    |
| `GET  /api/mcp/deployed/list/{spaceId}`    | 已部署 MCP 列表 |
| `POST /api/mcp/server/config/refresh/{id}` | 重新生成配置    |
| `POST /api/mcp/server/config/export/{id}`  | 导出配置        |

Agent 组件 API 中也有技能/MCP/插件/工作流组件更新：

- `POST /api/agent/component/mcp/update` — 更新 Agent 的 MCP 组件配置
- `POST /api/agent/component/skill/update` — 更新 Agent 的技能组件配置
- `POST /api/agent/component/plugin/update` — 更新 Agent 的插件组件配置
- `POST /api/agent/component/workflow/update` — 更新 Agent 的工作流组件配置

插件管理 API（`workspace/nuwax/src/services/plugin.ts`）：

| 端点                              | 能力           |
| --------------------------------- | -------------- |
| `POST /api/plugin/add`            | 新增插件       |
| `POST /api/plugin/http/update`    | 更新 HTTP 插件 |
| `POST /api/plugin/code/update`    | 更新 Code 插件 |
| `POST /api/plugin/test`           | 插件试运行     |
| `GET  /api/plugin/{id}`           | 插件详情       |
| `POST /api/plugin/delete/{id}`    | 删除插件       |
| `POST /api/plugin/publish`        | 发布插件       |
| `GET  /api/published/plugin/{id}` | 已发布插件信息 |

工作流管理 API（`workspace/nuwax/src/services/workflow.ts`）：

| 端点                                | 能力             |
| ----------------------------------- | ---------------- |
| `GET  /api/workflow/{id}`           | 获取工作流详情   |
| `POST /api/workflow/update`         | 更新工作流信息   |
| `POST /api/workflow/publish`        | 发布工作流       |
| `POST /api/workflow/test-run`       | 工作流试运行     |
| `GET  /api/workflow/node/list/{id}` | 获取节点列表     |
| `POST /api/workflow/node/add`       | 新增节点         |
| `POST /api/workflow/node/execute`   | 单节点试运行     |
| `GET  /api/published/workflow/{id}` | 已发布工作流信息 |

### V1 现有实现

#### MCP 层 (`packages/mcp.ts`)

**核心设计：配置下发 + stdio 聚合代理**

```
服务端 / ACP 下发 context_servers
              ↓
    syncMcpConfigToProxyAndReload(mcpServers)
              ↓
    ┌─────────────────────────────────────┐
    │  1. 合并默认服务 (chrome-devtools)    │
    │  2. 注入环境变量 (PATH, UV_*, etc.)   │
    │  3. 写入临时配置文件 (tmpdir)         │
    │  4. PersistentMcpBridge 重启         │
    │     (仅 persistent 服务)             │
    └─────────────────────────────────────┘
              ↓
    nuwax-mcp-stdio-proxy 聚合启动
              ↓
    Agent 引擎 (ACP) 通过 stdio 与 MCP servers 通信
```

**MCP Server 类型：**

| 类型 | 配置 | 启动方式 |
|------|------|----------|
| **stdio** | `{ command, args, env }` | mcp-proxy 按需 spawn 子进程 |
| **persistent** | `{ command, args, env, persistent: true }` | PersistentMcpBridge 长连接管理 |
| **remote** | `{ url, transport: "sse"\|"streamable-http" }` | 直接透传 URL |

**问题：**

1. 配置仅来自 ACP 下发，无法提前获取和管理
2. 客户端无法独立新增/修改 MCP 配置
3. 无法将客户端新增的 MCP 同步到服务器

#### Skills 层 (`renderer/services/integrations/skills.ts`)

- 仅在 Renderer 进程中实现 `SkillManager`
- 5 个硬编码内置技能（WebSearch、Calculator、FileRead、CommandRun、NetworkFetch）
- 无持久化、无与服务器同步、无动态新增/删除

**问题：**

1. Skills 仅在前端，无法被 Agent 引擎调用
2. 无法从服务器提前获取技能列表
3. Agent 自己新增的技能无法同步到服务器

---

## 二、V2 设计原则

### 2.1 双向管理 + 同步

| 数据类型 | 服务器职责 | 客户端职责 |
|----------|-----------|-----------|
| **MCP 配置** | CRUD + 存储 + Agent 组件绑定 | **提前获取** + **CRUD** + **推送到服务器** + 联动启动 |
| **Skills** | CRUD + 存储 + 发布 | **提前获取** + **CRUD** + **推送到服务器** |

### 2.2 核心能力

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      V2 工具管理核心能力                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 提前获取    →  主动从服务器拉取配置列表（不等 ACP 下发）              │
│  2. 修改管理    →  客户端独立 CRUD 配置                                  │
│  3. 同步到服务器 →  客户端新增/修改的配置推送到服务器                     │
│  4. 联动启动    →  MCP 配置变更后联动启动 proxy                          │
│  5. 冷启动优化  →  预热常用 MCP 包，解决首次安装慢                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.3 MCP 冷启动优化

#### 问题分析

V1 的 MCP 冷启动慢的原因：

```
首次启动 MCP Server (如 mcp-server-filesystem)
              ↓
    npx -y @anthropic/mcp-server-filesystem
              ↓
    ┌─────────────────────────────────────┐
    │  1. 检查本地缓存                      │
    │  2. 无缓存 → 下载 npm 包 (慢!)        │
    │  3. 安装依赖 (慢!)                    │
    │  4. 启动进程                          │
    └─────────────────────────────────────┘
              ↓
    首次启动可能需要 10-30 秒
```

#### V2 解决方案：MCP 预热机制

```
┌────────────────────────────────────────────────────────────────────────┐
│                      MCP 预热机制 (V2)                                  │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  1. 常用 MCP 包预定义                                              │  │
│  │                                                                   │  │
│  │  PREINSTALLED_MCP_PACKAGES = [                                   │  │
│  │    "@anthropic/mcp-server-filesystem",                           │  │
│  │    "@anthropic/mcp-server-github",                               │  │
│  │    "@anthropic/mcp-server-slack",                                │  │
│  │    "@anthropic/mcp-server-sqlite",                               │  │
│  │    "mcp-server-fetch",                                           │  │
│  │    "chrome-devtools-mcp",                                        │  │
│  │    // ... 更多常用包                                              │  │
│  │  ]                                                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  2. 应用启动时后台预热                                             │  │
│  │                                                                   │  │
│  │  async function warmupMcpPackages(): Promise<void> {             │  │
│  │    for (const pkg of PREINSTALLED_MCP_PACKAGES) {                │  │
│  │      // 检查是否已安装                                             │  │
│  │      if (!await isPackageCached(pkg)) {                          │  │
│  │        // 后台静默预下载                                           │  │
│  │        await predownloadPackage(pkg);                            │  │
│  │      }                                                            │  │
│  │    }                                                              │  │
│  │  }                                                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  3. 服务器配置同步时预热                                            │  │
│  │                                                                   │  │
│  │  async syncAgentMcpComponents(agentId): Promise<void> {          │  │
│  │    const mcps = await fetchFromServer(agentId);                  │  │
│  │                                                                   │  │
│  │    // 预热所有需要的 MCP 包                                        │  │
│  │    for (const mcp of mcps) {                                     │  │
│  │      await warmupMcpPackage(mcp.command, mcp.args);              │  │
│  │    }                                                              │  │
│  │                                                                   │  │
│  │    // 然后启动 proxy                                              │  │
│  │    await syncMcpConfigToProxyAndReload(mcps);                    │  │
│  │  }                                                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  4. 进度提示与状态展示                                              │  │
│  │                                                                   │  │
│  │  UI 显示: "正在准备 MCP 服务 (3/5)..."                            │  │
│  │  ┌──────────────────────────────────────┐                        │  │
│  │  │ ████████░░░░░░░░  60%                │                        │  │
│  │  │ 正在下载: mcp-server-github           │                        │  │
│  │  └──────────────────────────────────────┘                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

#### McpWarmupService 实现

```typescript
/**
 * MCP 预热服务
 * 
 * 职责：
 * - 应用启动时预热常用 MCP 包
 * - 服务器配置同步时预热需要的包
 * - 提供预热进度回调
 */
class McpWarmupService {
  private warmupStatus: Map<string, WarmupStatus> = new Map();
  private npmCache: string; // npm 缓存目录

  /** 预定义的常用 MCP 包 */
  private readonly PREINSTALLED_PACKAGES = [
    { name: "@anthropic/mcp-server-filesystem", command: "npx", args: ["-y", "@anthropic/mcp-server-filesystem"] },
    { name: "@anthropic/mcp-server-github", command: "npx", args: ["-y", "@anthropic/mcp-server-github"] },
    { name: "mcp-server-fetch", command: "npx", args: ["-y", "mcp-server-fetch"] },
    { name: "chrome-devtools-mcp", command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] },
    // uvx 包
    { name: "mcp-server-sqlite", command: "uvx", args: ["mcp-server-sqlite"] },
  ];

  /**
   * 应用启动时预热常用包
   */
  async warmupOnStartup(
    onProgress?: (status: WarmupProgress) => void,
  ): Promise<void> {
    const total = this.PREINSTALLED_PACKAGES.length;
    let completed = 0;

    for (const pkg of this.PREINSTALLED_PACKAGES) {
      onProgress?.({
        phase: "startup",
        current: pkg.name,
        completed,
        total,
        percent: Math.round((completed / total) * 100),
      });

      await this.warmupPackage(pkg.name, pkg.command, pkg.args);
      completed++;
    }

    onProgress?.({
      phase: "complete",
      current: null,
      completed: total,
      total,
      percent: 100,
    });
  }

  /**
   * 预热单个 MCP 包
   */
  async warmupPackage(
    packageName: string,
    command: string,
    args: string[],
  ): Promise<WarmupResult> {
    // 1. 检查是否已缓存
    if (await this.isPackageCached(packageName)) {
      this.warmupStatus.set(packageName, { cached: true, warmedAt: Date.now() });
      return { cached: true, alreadyCached: true };
    }

    // 2. 执行预热命令（静默下载到缓存）
    this.warmupStatus.set(packageName, { cached: false, warming: true });

    try {
      if (command === "npx" || command === "npm") {
        await this.warmupNpxPackage(packageName, args);
      } else if (command === "uvx" || command === "uv") {
        await this.warmupUvxPackage(packageName, args);
      }

      this.warmupStatus.set(packageName, { cached: true, warmedAt: Date.now() });
      return { cached: true, alreadyCached: false };
    } catch (error) {
      this.warmupStatus.set(packageName, { cached: false, error: String(error) });
      return { cached: false, error: String(error) };
    }
  }

  /**
   * 检查包是否已缓存
   */
  private async isPackageCached(packageName: string): Promise<boolean> {
    // 检查 npm 缓存
    const npmCached = await this.checkNpmCache(packageName);
    if (npmCached) return true;

    // 检查 uv 缓存
    const uvCached = await this.checkUvCache(packageName);
    return uvCached;
  }

  /**
   * 预热 npx 包
   */
  private async warmupNpxPackage(packageName: string, args: string[]): Promise<void> {
    // 使用 npx --yes 预下载包（不实际运行）
    // 或者直接 npm pack 然后解压到缓存
    const { execFile } = require("child_process");
    
    return new Promise((resolve, reject) => {
      const proc = execFile(
        "npx",
        [...args, "--help"], // 只获取帮助，不实际运行服务
        { timeout: 60000 },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
  }

  /**
   * 预热 uvx 包
   */
  private async warmupUvxPackage(packageName: string, args: string[]): Promise<void> {
    const { execFile } = require("child_process");
    const uvPath = getUvBinPath();
    
    return new Promise((resolve, reject) => {
      const proc = execFile(
        uvPath,
        ["tool", "install", packageName, "--quiet"],
        { timeout: 120000 },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
  }

  /**
   * 获取预热状态
   */
  getWarmupStatus(): Record<string, WarmupStatus> {
    return Object.fromEntries(this.warmupStatus);
  }

  /**
   * 批量预热（用于服务器配置同步）
   */
  async warmupForMcpConfigs(
    configs: McpConfigEntry[],
    onProgress?: (status: WarmupProgress) => void,
  ): Promise<void> {
    const packages = configs
      .filter((c) => c.transport.type === "stdio")
      .map((c) => ({
        name: this.extractPackageName(c.transport.command, c.transport.args),
        command: c.transport.command,
        args: c.transport.args || [],
      }))
      .filter((p, i, arr) => 
        p.name && arr.findIndex((x) => x.name === p.name) === i, // 去重
      );

    const total = packages.length;
    let completed = 0;

    for (const pkg of packages) {
      onProgress?.({
        phase: "sync",
        current: pkg.name,
        completed,
        total,
        percent: Math.round((completed / total) * 100),
      });

      await this.warmupPackage(pkg.name, pkg.command, pkg.args);
      completed++;
    }

    onProgress?.({
      phase: "complete",
      current: null,
      completed: total,
      total,
      percent: 100,
    });
  }

  /**
   * 从命令和参数中提取包名
   */
  private extractPackageName(command: string, args: string[]): string {
    if (command === "npx" || command.includes("npx")) {
      // npx -y @anthropic/mcp-server-filesystem
      const idx = args.indexOf("-y");
      if (idx >= 0 && args[idx + 1]) {
        return args[idx + 1].split("@")[0] || args[idx + 1];
      }
    }
    if (command === "uvx" || command.includes("uvx")) {
      // uvx mcp-server-sqlite
      return args[0] || "";
    }
    return "";
  }
}

interface WarmupStatus {
  cached: boolean;
  warmedAt?: number;
  warming?: boolean;
  error?: string;
}

interface WarmupProgress {
  phase: "startup" | "sync" | "complete";
  current: string | null;
  completed: number;
  total: number;
  percent: number;
}

interface WarmupResult {
  cached: boolean;
  alreadyCached?: boolean;
  error?: string;
}
```

#### 与 McpManager 集成

```typescript
class McpManager {
  private warmupService: McpWarmupService;

  /**
   * 从服务器同步 MCP 配置时，先预热再启动
   */
  async syncAgentMcpComponents(
    agentId: number,
    onProgress?: (status: WarmupProgress) => void,
  ): Promise<SyncResult> {
    // 1. 从服务器拉取配置
    const mcps = await this.fetchFromServer(agentId);

    // 2. 预热需要的 MCP 包
    await this.warmupService.warmupForMcpConfigs(mcps, onProgress);

    // 3. 启动 proxy（此时包已缓存，启动很快）
    await this.applyMcpConfig();

    return {
      success: true,
      pulled: mcps.length,
      pushed: 0,
      conflicts: [],
    };
  }
}
```

#### UI 进度展示

```
┌─ MCP 服务准备中 ──────────────────────────────────────────────────────┐
│                                                                       │
│  ████████████████░░░░░░░░  67%                                       │
│                                                                       │
│  正在准备: @anthropic/mcp-server-github                               │
│                                                                       │
│  ✓ @anthropic/mcp-server-filesystem (已缓存)                         │
│  ✓ mcp-server-fetch (已缓存)                                         │
│  ○ @anthropic/mcp-server-github (下载中...)                          │
│  ○ chrome-devtools-mcp (等待中)                                      │
│                                                                       │
│  [跳过] [后台运行]                                                     │
└───────────────────────────────────────────────────────────────────────┘
```

### 2.4 MCP 架构（V2 增强版）

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Nuwax Agent OS (服务器)                              │
│  /api/mcp/create  ·  /api/mcp/update  ·  /api/mcp/list/{spaceId}      │
│  /api/mcp/{id}    ·  /api/mcp/test    ·  /api/mcp/stop/{id}           │
│  /api/agent/component/mcp/update                                      │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
            提前获取/同步              Agent 组件绑定同步
                    │                         │
                    ▼                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    NuwaClaw Client (Electron)                          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  McpManager (V2 增强)                                             │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │ list()      │  │ create()    │  │ update()    │              │  │
│  │  │ 从服务器拉取 │  │ 本地+服务器  │  │ 本地+服务器  │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │ delete()    │  │ test()      │  │ syncToServer│              │  │
│  │  │ 本地+服务器  │  │ 本地试运行   │  │ 推送变更    │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                 │                                      │
│                                 ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  mcpProxyManager (保持 V1 实现)                                    │  │
│  │  - syncMcpConfigToProxyAndReload(mcpServers)                      │  │
│  │  - getAgentMcpConfig() → 注入 ACP 引擎                             │  │
│  │  - PersistentMcpBridge 管理 persistent 服务                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                 │                                      │
│                                 ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  nuwax-mcp-stdio-proxy (聚合层)                                    │  │
│  │  - stdio 聚合所有 MCP servers                                      │  │
│  │  - 支持 stdio / sse / streamable-http 传输                        │  │
│  │  - 工具白名单/黑名单过滤                                           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 三、MCP 管理层设计

### 3.1 McpManager（V2 增强）

```typescript
/**
 * MCP 管理器 (V2)
 * 
 * 核心能力：
 * 1. 提前获取 - 从服务器拉取 MCP 配置列表
 * 2. 修改管理 - 本地 CRUD + 同步到服务器
 * 3. 联动启动 - 配置变更后触发 proxy 重启
 */
class McpManager {
  private nuwaxClient: NuwaxApiClient;
  private localConfig: Map<string, McpConfigEntry> = new Map();
  private syncStatus: Map<string, SyncStatus> = new Map();

  // ==================== 提前获取 ====================

  /**
   * 从服务器拉取 Space 下的所有 MCP 配置
   * （可独立于 Agent 使用，提前获取并展示）
   */
  async fetchFromServer(spaceId: number): Promise<McpConfigEntry[]> {
    const list = await this.nuwaxClient.request<McpDetailInfo[]>(
      "GET",
      `/api/mcp/list/${spaceId}`,
    );

    // 更新本地缓存
    for (const item of list) {
      this.localConfig.set(item.id, this.mapServerToLocal(item));
      this.syncStatus.set(item.id, { synced: true, lastSyncAt: Date.now() });
    }

    return list.map((item) => this.mapServerToLocal(item));
  }

  /**
   * 获取单个 MCP 配置详情
   */
  async getDetail(mcpId: number): Promise<McpConfigEntry> {
    const detail = await this.nuwaxClient.request<McpDetailInfo>(
      "GET",
      `/api/mcp/${mcpId}`,
    );
    return this.mapServerToLocal(detail);
  }

  // ==================== 修改管理 ====================

  /**
   * 创建新的 MCP 配置
   * → 先保存到本地，再同步到服务器
   */
  async create(config: McpCreateInput): Promise<McpConfigEntry> {
    // 1. 本地验证
    this.validateConfig(config);

    // 2. 同步到服务器
    const serverResult = await this.nuwaxClient.request<McpDetailInfo>(
      "POST",
      "/api/mcp/create",
      {
        name: config.name,
        description: config.description,
        type: config.transport.type,
        config: config.transport,
      },
    );

    // 3. 更新本地缓存
    const entry = this.mapServerToLocal(serverResult);
    this.localConfig.set(entry.id, entry);
    this.syncStatus.set(entry.id, { synced: true, lastSyncAt: Date.now() });

    // 4. 如果标记为自动启动，联动启动
    if (config.autoStart) {
      await this.applyMcpConfig();
    }

    return entry;
  }

  /**
   * 更新 MCP 配置
   * → 本地 + 服务器同步
   */
  async update(mcpId: string, updates: McpUpdateInput): Promise<McpConfigEntry> {
    const existing = this.localConfig.get(mcpId);
    if (!existing) {
      throw new Error(`MCP ${mcpId} not found`);
    }

    // 1. 同步到服务器
    await this.nuwaxClient.request(
      "POST",
      "/api/mcp/update",
      {
        id: mcpId,
        name: updates.name,
        description: updates.description,
        config: updates.transport,
      },
    );

    // 2. 更新本地缓存
    const updated: McpConfigEntry = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    this.localConfig.set(mcpId, updated);
    this.syncStatus.set(mcpId, { synced: true, lastSyncAt: Date.now() });

    // 3. 联动启动
    await this.applyMcpConfig();

    return updated;
  }

  /**
   * 删除 MCP 配置
   * → 本地 + 服务器同步
   */
  async delete(mcpId: string): Promise<void> {
    // 1. 从服务器删除
    await this.nuwaxClient.request(
      "POST",
      "/api/mcp/stop",
      { id: mcpId },
    );

    // 2. 从本地移除
    this.localConfig.delete(mcpId);
    this.syncStatus.delete(mcpId);

    // 3. 联动启动（更新 proxy 配置）
    await this.applyMcpConfig();
  }

  /**
   * 测试 MCP 配置（本地试运行）
   */
  async test(mcpId: string): Promise<McpTestResult> {
    const config = this.localConfig.get(mcpId);
    if (!config) {
      throw new Error(`MCP ${mcpId} not found`);
    }

    // 可选：委托服务器测试
    // return await this.nuwaxClient.request("POST", "/api/mcp/test", { id: mcpId });

    // 或本地测试（启动临时进程验证）
    return await this.testMcpLocally(config);
  }

  // ==================== Agent 组件绑定 ====================

  /**
   * 绑定 MCP 到 Agent
   * → 更新 Agent 组件配置
   */
  async bindToAgent(agentId: number, mcpIds: string[]): Promise<void> {
    await this.nuwaxClient.request(
      "POST",
      `/api/agent/component/mcp/update`,
      {
        agentId,
        mcpIds: mcpIds.map((id) => parseInt(id)),
      },
    );

    // 联动启动
    await this.applyMcpConfig();
  }

  /**
   * 获取 Agent 绑定的 MCP 配置
   */
  async getAgentMcpConfig(agentId: number): Promise<McpConfigEntry[]> {
    const components = await this.nuwaxClient.request<AgentComponentInfo[]>(
      "GET",
      `/api/agent/component/list/${agentId}`,
    );

    const mcpComponents = components.filter((c) => c.type === "mcp");
    const results: McpConfigEntry[] = [];

    for (const mc of mcpComponents) {
      const detail = await this.getDetail(mc.refId);
      results.push(detail);
    }

    return results;
  }

  // ==================== 联动启动 ====================

  /**
   * 应用 MCP 配置到 proxy
   * → 调用 V1 的 syncMcpConfigToProxyAndReload
   */
  private async applyMcpConfig(): Promise<void> {
    const mcpServers: Record<string, McpServerEntry> = {};

    for (const [id, config] of this.localConfig) {
      if (config.enabled) {
        mcpServers[config.name] = this.mapToServerEntry(config);
      }
    }

    await syncMcpConfigToProxyAndReload(mcpServers);
  }

  // ==================== 辅助方法 ====================

  /**
   * 列出本地缓存的 MCP 配置
   */
  listLocal(): McpConfigEntry[] {
    return Array.from(this.localConfig.values());
  }

  /**
   * 获取同步状态
   */
  getSyncStatus(): Record<string, SyncStatus> {
    return Object.fromEntries(this.syncStatus);
  }

  /**
   * 手动推送本地变更到服务器
   */
  async syncToServer(): Promise<SyncResult> {
    let pushed = 0;
    for (const [id, status] of this.syncStatus) {
      if (!status.synced) {
        const config = this.localConfig.get(id);
        if (config) {
          await this.nuwaxClient.request("POST", "/api/mcp/update", {
            id,
            name: config.name,
            config: config.transport,
          });
          status.synced = true;
          status.lastSyncAt = Date.now();
          pushed++;
        }
      }
    }
    return { success: true, pulled: 0, pushed, conflicts: [] };
  }

  private mapServerToLocal(server: McpDetailInfo): McpConfigEntry {
    return {
      id: String(server.id),
      name: server.name,
      description: server.description || "",
      transport: server.config,
      enabled: server.enabled ?? true,
      autoStart: server.autoStart ?? false,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    };
  }

  private mapToServerEntry(config: McpConfigEntry): McpServerEntry {
    const transport = config.transport;
    if (transport.url) {
      return {
        url: transport.url,
        transport: transport.transportType,
        headers: transport.headers,
        authToken: transport.authToken,
      };
    }
    return {
      command: transport.command,
      args: transport.args || [],
      env: transport.env,
      persistent: transport.persistent,
    };
  }
}
```

### 3.2 类型定义

```typescript
/** MCP 配置条目 */
interface McpConfigEntry {
  id: string;
  name: string;
  description: string;
  transport: McpTransportConfig;
  enabled: boolean;
  autoStart: boolean;
  createdAt: number;
  updatedAt: number;
}

/** MCP 传输配置 */
type McpTransportConfig =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
      persistent?: boolean;
    }
  | {
      type: "sse";
      url: string;
      headers?: Record<string, string>;
      authToken?: string;
    }
  | {
      type: "streamable-http";
      url: string;
      headers?: Record<string, string>;
      authToken?: string;
    };

/** 创建 MCP 输入 */
interface McpCreateInput {
  name: string;
  description?: string;
  transport: McpTransportConfig;
  autoStart?: boolean;
}

/** 更新 MCP 输入 */
interface McpUpdateInput {
  name?: string;
  description?: string;
  transport?: McpTransportConfig;
  enabled?: boolean;
  autoStart?: boolean;
}

/** MCP 测试结果 */
interface McpTestResult {
  success: boolean;
  tools?: string[]; // 发现的工具列表
  error?: string;
  latencyMs: number;
}

/** 同步状态 */
interface SyncStatus {
  synced: boolean;
  lastSyncAt: number;
  error?: string;
}
```

---

## 四、Skills 管理层设计

### 4.1 SkillManager（V2 增强）

```typescript
/**
 * 技能管理器 (V2)
 * 
 * 核心能力：
 * 1. 提前获取 - 从服务器拉取技能列表
 * 2. 修改管理 - 本地 CRUD + 同步到服务器
 * 3. Agent 学习技能 - Agent 自创建并推送
 */
class SkillManager {
  private nuwaxClient: NuwaxApiClient;
  private skills: Map<string, SkillEntry> = new Map();
  private syncStatus: Map<string, SyncStatus> = new Map();

  // ==================== 提前获取 ====================

  /**
   * 从服务器拉取 Space 下的所有技能
   */
  async fetchFromServer(spaceId: number): Promise<SkillEntry[]> {
    const list = await this.nuwaxClient.request<SkillDetailInfo[]>(
      "GET",
      `/api/published/skill/list`,
      { spaceId },
    );

    for (const item of list) {
      this.skills.set(String(item.id), this.mapServerToLocal(item));
      this.syncStatus.set(String(item.id), { synced: true, lastSyncAt: Date.now() });
    }

    return list.map((item) => this.mapServerToLocal(item));
  }

  /**
   * 获取技能详情
   */
  async getDetail(skillId: number): Promise<SkillEntry> {
    const detail = await this.nuwaxClient.request<SkillDetailInfo>(
      "GET",
      `/api/skill/${skillId}`,
    );
    return this.mapServerToLocal(detail);
  }

  /**
   * 导出技能
   */
  async export(skillId: number): Promise<Buffer> {
    const response = await this.nuwaxClient.request<ArrayBuffer>(
      "GET",
      `/api/skill/export/${skillId}`,
    );
    return Buffer.from(response);
  }

  // ==================== 修改管理 ====================

  /**
   * 创建新技能
   */
  async create(input: SkillCreateInput): Promise<SkillEntry> {
    // 1. 同步到服务器
    const result = await this.nuwaxClient.request<SkillDetailInfo>(
      "POST",
      "/api/skill/update",
      {
        name: input.name,
        description: input.description,
        content: input.content,
        type: input.type,
      },
    );

    // 2. 更新本地缓存
    const entry = this.mapServerToLocal(result);
    this.skills.set(entry.id, entry);
    this.syncStatus.set(entry.id, { synced: true, lastSyncAt: Date.now() });

    return entry;
  }

  /**
   * 更新技能
   */
  async update(skillId: string, updates: SkillUpdateInput): Promise<SkillEntry> {
    const existing = this.skills.get(skillId);
    if (!existing) {
      throw new Error(`Skill ${skillId} not found`);
    }

    // 1. 同步到服务器
    await this.nuwaxClient.request(
      "POST",
      "/api/skill/update",
      {
        id: skillId,
        name: updates.name,
        description: updates.description,
        content: updates.content,
      },
    );

    // 2. 更新本地缓存
    const updated: SkillEntry = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    this.skills.set(skillId, updated);
    this.syncStatus.set(skillId, { synced: true, lastSyncAt: Date.now() });

    return updated;
  }

  /**
   * 删除技能
   */
  async delete(skillId: string): Promise<void> {
    // Skills 删除通过导入接口的删除功能，或直接从 Agent 组件解绑
    this.skills.delete(skillId);
    this.syncStatus.delete(skillId);
  }

  /**
   * 导入技能（从文件或 zip）
   */
  async import(skillZip: Buffer): Promise<SkillEntry> {
    const result = await this.nuwaxClient.request<SkillDetailInfo>(
      "POST",
      "/api/skill/import",
      skillZip,
      { headers: { "Content-Type": "multipart/form-data" } },
    );

    const entry = this.mapServerToLocal(result);
    this.skills.set(entry.id, entry);
    this.syncStatus.set(entry.id, { synced: true, lastSyncAt: Date.now() });

    return entry;
  }

  // ==================== Agent 组件绑定 ====================

  /**
   * 绑定技能到 Agent
   */
  async bindToAgent(agentId: number, skillIds: string[]): Promise<void> {
    await this.nuwaxClient.request(
      "POST",
      `/api/agent/component/skill/update`,
      {
        agentId,
        skillIds: skillIds.map((id) => parseInt(id)),
      },
    );
  }

  /**
   * 获取 Agent 绑定的技能
   */
  async getAgentSkills(agentId: number): Promise<SkillEntry[]> {
    const components = await this.nuwaxClient.request<AgentComponentInfo[]>(
      "GET",
      `/api/agent/component/list/${agentId}`,
    );

    const skillComponents = components.filter((c) => c.type === "skill");
    const results: SkillEntry[] = [];

    for (const sc of skillComponents) {
      const detail = await this.getDetail(sc.refId);
      results.push(detail);
    }

    return results;
  }

  // ==================== Agent 学习技能 ====================

  /**
   * Agent 自创建技能
   * → 创建后自动推送到服务器
   */
  async createLearnedSkill(definition: LearnedSkillDefinition): Promise<SkillEntry> {
    // 1. 构建技能内容
    const skillContent = this.buildSkillContent(definition);

    // 2. 创建并同步到服务器
    const entry = await this.create({
      name: definition.name,
      description: definition.description,
      content: skillContent,
      type: "learned",
    });

    // 3. 记录来源
    entry.origin = definition.origin;

    return entry;
  }

  // ==================== 辅助方法 ====================

  /**
   * 列出本地缓存的技能
   */
  listLocal(filter?: { type?: string; enabled?: boolean }): SkillEntry[] {
    let results = Array.from(this.skills.values());
    if (filter?.type) {
      results = results.filter((s) => s.type === filter.type);
    }
    if (filter?.enabled !== undefined) {
      results = results.filter((s) => s.enabled === filter.enabled);
    }
    return results;
  }

  /**
   * 获取同步状态
   */
  getSyncStatus(): Record<string, SyncStatus> {
    return Object.fromEntries(this.syncStatus);
  }

  private mapServerToLocal(server: SkillDetailInfo): SkillEntry {
    return {
      id: String(server.id),
      name: server.name,
      description: server.description || "",
      content: server.content,
      type: server.type || "custom",
      enabled: server.enabled ?? true,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    };
  }

  private buildSkillContent(definition: LearnedSkillDefinition): string {
    // 根据实现类型构建技能内容
    if (definition.implementation.type === "script") {
      return `# ${definition.name}\n\n${definition.description}\n\n\`\`\`${definition.implementation.language}\n${definition.implementation.code}\n\`\`\``;
    }
    // ... 其他类型
    return "";
  }
}
```

### 4.2 类型定义

```typescript
/** 技能条目 */
interface SkillEntry {
  id: string;
  name: string;
  description: string;
  content: string; // 技能定义（Markdown / JSON / 代码）
  type: "built-in" | "custom" | "learned" | "synced";
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  origin?: {
    memoryId?: string;
    sessionId?: string;
    reason?: string;
  };
}

/** 创建技能输入 */
interface SkillCreateInput {
  name: string;
  description?: string;
  content: string;
  type?: string;
}

/** 更新技能输入 */
interface SkillUpdateInput {
  name?: string;
  description?: string;
  content?: string;
  enabled?: boolean;
}

/** Agent 学习技能定义 */
interface LearnedSkillDefinition {
  name: string;
  description: string;
  implementation:
    | {
        type: "script";
        language: "bash" | "node" | "python";
        code: string;
        timeout?: number;
      }
    | {
        type: "composite";
        steps: { toolId: string; args: Record<string, string> }[];
      };
  origin: {
    memoryId?: string;
    sessionId?: string;
    reason: string;
  };
}
```

---

## 五、统一工具层

### 5.1 ToolRegistry（工具注册中心）

将 MCP Tools、Skills、Plugin、Workflow 统一管理：

```typescript
/**
 * 工具注册中心
 * 
 * 统一管理所有工具来源，提供统一接口给 Agent 引擎
 */
class ToolRegistry {
  private mcpManager: McpManager;
  private skillManager: SkillManager;
  private tools: Map<string, UnifiedTool> = new Map();

  /**
   * 刷新所有工具（从 MCP servers 和 Skills 获取）
   */
  async refreshAll(): Promise<void> {
    // 1. 从 MCP servers 获取工具
    await this.refreshMcpTools();

    // 2. 从 Skills 获取工具
    await this.refreshSkillTools();
  }

  /**
   * 从 MCP servers 刷新工具列表
   */
  private async refreshMcpTools(): Promise<void> {
    const mcpConfigs = this.mcpManager.listLocal();
    
    for (const config of mcpConfigs) {
      if (config.enabled) {
        // 通过 mcp-proxy 获取工具列表
        const tools = await this.fetchMcpServerTools(config);
        for (const tool of tools) {
          this.tools.set(tool.id, tool);
        }
      }
    }
  }

  /**
   * 从 Skills 刷新工具列表
   */
  private async refreshSkillTools(): Promise<void> {
    const skills = this.skillManager.listLocal({ enabled: true });
    
    for (const skill of skills) {
      const tool = this.mapSkillToTool(skill);
      this.tools.set(tool.id, tool);
    }
  }

  /**
   * 列出所有工具
   */
  listTools(filter?: ToolFilter): UnifiedTool[] {
    let results = Array.from(this.tools.values());
    
    if (filter?.category) {
      results = results.filter((t) => t.category === filter.category);
    }
    if (filter?.source) {
      results = results.filter((t) => t.source.type === filter.source);
    }
    
    return results;
  }

  /**
   * 获取工具 schemas（给 LLM 的 function calling）
   */
  getToolSchemas(): ToolSchema[] {
    return this.listTools()
      .filter((t) => t.enabled)
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
  }

  /**
   * 执行工具
   */
  async execute(
    toolId: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }

    const startTime = Date.now();
    try {
      let result: unknown;

      switch (tool.source.type) {
        case "mcp":
          result = await this.executeMcpTool(tool, args);
          break;
        case "skill":
          result = await this.executeSkill(tool, args, context);
          break;
        case "built-in":
          result = await this.executeBuiltIn(tool, args, context);
          break;
        default:
          throw new Error(`Unknown tool source: ${tool.source.type}`);
      }

      return {
        success: true,
        output: result,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: String(error),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
```

### 5.2 统一工具接口

```typescript
/** 统一工具定义 */
interface UnifiedTool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  source: ToolSource;
  parameters: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  enabled: boolean;
  requiresPermission: boolean;
  metadata: {
    createdAt: number;
    updatedAt: number;
    usageCount: number;
    successRate: number;
  };
}

type ToolCategory =
  | "file"
  | "network"
  | "system"
  | "data"
  | "ai"
  | "mcp"
  | "skill"
  | "custom";

type ToolSource =
  | { type: "built-in" }
  | { type: "mcp"; serverId: string; serverName: string }
  | { type: "skill"; skillId: string; skillName: string }
  | { type: "plugin"; pluginId: number }
  | { type: "workflow"; workflowId: number };
```

---

## 六、IPC 接口设计

```typescript
// ==================== MCP ====================

// 提前获取
'mcp:fetch'               → McpConfigEntry[]        // 从服务器拉取列表
'mcp:detail'              → McpConfigEntry          // 获取详情

// CRUD
'mcp:create'              → McpConfigEntry          // 创建（同步到服务器）
'mcp:update'              → McpConfigEntry          // 更新（同步到服务器）
'mcp:delete'              → { success: boolean }    // 删除（同步到服务器）
'mcp:test'                → McpTestResult           // 本地试运行

// Agent 绑定
'mcp:bind:agent'          → { success: boolean }    // 绑定到 Agent
'mcp:agent:list'          → McpConfigEntry[]        // Agent 绑定的 MCP

// 状态
'mcp:list'                → McpConfigEntry[]        // 本地缓存列表
'mcp:status'              → McpProxyStatus          // V1 已有
'mcp:sync:status'         → Record<string, SyncStatus>

// ==================== Skills ====================

// 提前获取
'skill:fetch'             → SkillEntry[]            // 从服务器拉取列表
'skill:detail'            → SkillEntry              // 获取详情
'skill:export'            → Buffer                  // 导出

// CRUD
'skill:create'            → SkillEntry              // 创建（同步到服务器）
'skill:update'            → SkillEntry              // 更新（同步到服务器）
'skill:delete'            → { success: boolean }    // 删除
'skill:import'            → SkillEntry              // 导入

// Agent 绑定
'skill:bind:agent'        → { success: boolean }    // 绑定到 Agent
'skill:agent:list'        → SkillEntry[]            // Agent 绑定的技能

// Agent 学习
'skill:learned:create'    → SkillEntry              // Agent 自创建

// 状态
'skill:list'              → SkillEntry[]            // 本地缓存列表
'skill:sync:status'       → Record<string, SyncStatus>

// ==================== Tools ====================

'tools:list'              → UnifiedTool[]
'tools:schemas'           → ToolSchema[]
'tools:execute'           → ToolResult
'tools:refresh'           → { success: boolean }
```

---

## 七、UI 设计要点

### MCP 管理页（完整 CRUD）

```
┌─ MCP 服务器管理 ─────────────────────────────────────────────────────┐
│                                                                      │
│  当前 Space: 开发环境                              [从服务器同步]     │
│                                                                      │
│  ── 已配置的 MCP 服务器 ────────────────────────────  [+ 添加 MCP]    │
│                                                                      │
│  ● filesystem      ✓ 运行中  │ 3 工具  │ stdio         [编辑] [删除] │
│  ● github          ✓ 运行中  │ 8 工具  │ stdio         [编辑] [删除] │
│  ● remote-api      ✓ 连接中  │ 5 工具  │ sse           [编辑] [删除] │
│  ○ slack           ✗ 已停止  │ 0 工具  │ stdio         [编辑] [删除] │
│                                                                      │
│  ── 添加/编辑 MCP ─────────────────────────────────────────────────── │
│                                                                      │
│  名称:    [________________]                                        │
│  描述:    [________________]                                        │
│  类型:    ○ stdio  ○ SSE  ○ Streamable HTTP                        │
│                                                                      │
│  ── stdio 配置 ──────────────────────                                │
│  命令:    [npx -y @anthropic/mcp-server-filesystem____]             │
│  参数:    [/Users/apple/workspace_____________________]             │
│  环境变量: [+ 添加]                                                   │
│  ☑ 自动启动                                                         │
│                                                                      │
│  [测试连接]  [保存并同步到服务器]  [取消]                             │
│                                                                      │
│  上次同步: 5 分钟前   同步状态: ✓ 已同步                              │
└──────────────────────────────────────────────────────────────────────┘
```

### 技能管理页（完整 CRUD）

```
┌─ 技能管理 ───────────────────────────────────────────────────────────┐
│                                                                      │
│  当前 Space: 开发环境                              [从服务器同步]     │
│                                                                      │
│  [全部] [内置] [服务器同步] [Agent 学习]              [+ 创建技能]    │
│                                                                      │
│  ── 已配置的技能 ────────────────────────────────────────────────────│
│                                                                      │
│  │ Web Search       │ 搜索网页信息      │ ✓ │ 内置      [查看]      │
│  │ json-parser      │ JSON 文件解析     │ ✓ │ 服务器    [编辑][删除] │
│  │ api-client       │ API 请求封装      │ ✓ │ 服务器    [编辑][删除] │
│  │ parse-log        │ 日志分析          │ ✓ │ Agent学习 [编辑][删除] │
│                                                                      │
│  ── 创建/编辑技能 ──────────────────────────────────────────────────  │
│                                                                      │
│  名称:    [________________]                                        │
│  描述:    [________________]                                        │
│  类型:    ○ 自定义  ○ 脚本  ○ 组合                                   │
│                                                                      │
│  ── 技能内容 ──────────────────────                                  │
│  ```python                                                           │
│  import json                                                         │
│  def parse_json(content):                                            │
│      return json.loads(content)                                      │
│  ```                                                                 │
│                                                                      │
│  [测试]  [保存并同步到服务器]  [取消]                                 │
│                                                                      │
│  上次同步: 2 分钟前   同步状态: ✓ 已同步                              │
└──────────────────────────────────────────────────────────────────────┘
```

### Agent 工具绑定

```
┌─ Agent 工具配置 ─────────────────────────────────────────────────────┐
│                                                                      │
│  Agent: Claude Assistant                                             │
│                                                                      │
│  ── MCP 服务器 ─────────────────────────────────  [+ 添加 MCP]       │
│  ☑ filesystem      ✓ 运行中  │ 3 工具                               │
│  ☑ github          ✓ 运行中  │ 8 工具                               │
│  ☐ slack           ✗ 已停止  │ 0 工具                               │
│                                                                      │
│  ── 技能 ─────────────────────────────────────────  [+ 添加技能]     │
│  ☑ json-parser     │ JSON 文件解析                                  │
│  ☑ api-client      │ API 请求封装                                   │
│  ☐ code-review     │ 代码审查                                       │
│                                                                      │
│  ── 插件 ────────────────────────────────────────  [+ 添加插件]      │
│  (无)                                                                │
│                                                                      │
│  ── 工作流 ──────────────────────────────────────── [+ 添加工作流]   │
│  (无)                                                                │
│                                                                      │
│  [保存配置]                                                          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 相关文档

- [总体架构](./01-ARCHITECTURE.md)
- [知识库 · 工作流 · 插件](./07-KNOWLEDGE-WORKFLOW-PLUGIN.md)
- [V1 MCP 实现](../../src/main/services/packages/mcp.ts)
- [V1 Skills](../../src/renderer/services/integrations/skills.ts)
- [Agent 自我进化](./06-SELF-EVOLUTION.md)
