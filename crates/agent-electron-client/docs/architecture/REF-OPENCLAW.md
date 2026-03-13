---
version: 2.3
last-updated: 2026-02-24
status: reference
---

# openclaw 架构参考文档

> 本文档分析 openclaw AI 助手项目的优秀架构设计，为 Nuwax Agent Electron 客户端提供改进参考。
>
> **源仓库**: https://github.com/openclaw/openclaw
> **创建日期**: 2026-02-24

---

## 目录

1. [项目概述](#1-项目概述)
2. [架构对比](#2-架构对比)
3. [可借鉴的设计模式](#3-可借鉴的设计模式)
4. [具体改进建议](#4-具体改进建议)
5. [实施路线图](#5-实施路线图)

---

## 1. 项目概述

### 1.1 openclaw 项目

- **仓库地址**: https://github.com/openclaw/openclaw
- **语言**: TypeScript (ESM)
- **运行时**: Node.js 22+ / Bun
- **类型**: 个人 AI 助手平台
- **架构特点**: 多通道消息集成 + 插件化架构

**核心功能**:
- 多通道消息集成 (Telegram, Slack, Discord, WhatsApp, Signal, iMessage, Google Chat 等)
- Gateway 网关服务 (WebSocket 控制平面)
- 技能系统 (Skills) 和插件扩展
- 跨平台客户端 (macOS/iOS/Android)
- AI Agent 运行时 (Pi Agent Core)

### 1.2 Nuwax Agent Electron 项目

- **路径**: `/Users/apple/workspace/nuwax-agent/crates/agent-electron-client`
- **语言**: TypeScript / Rust (核心层)
- **运行时**: Electron / Node.js
- **类型**: AI Agent 桌面客户端
- **架构特点**: Electron 双进程 + 服务分层

**核心功能**:
- 多引擎 Agent 支持 (claude-code / nuwaxcode)
- ACP 协议集成
- 沙箱执行和权限管理
- MCP (Model Context Protocol) 支持
- IM 集成 (Telegram/Discord/DingTalk/Feishu)

---

## 2. 架构对比

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          openclaw                                   │
├─────────────────────────────────────────────────────────────────────┤
│  CLI Layer (src/cli/)                                               │
│  ├── build-program.ts (程序构建器)                                   │
│  ├── command-registry.ts (命令注册)                                  │
│  └── program-context.ts (上下文管理)                                  │
│       ↓                                                             │
│  Gateway Layer (src/gateway/)                                       │
│  ├── server.impl.ts (WebSocket 服务器)                               │
│  ├── server-methods.ts (RPC 方法)                                    │
│  ├── server-channels.ts (通道管理)                                   │
│  └── server-plugins.ts (插件加载)                                    │
│       ↓                                                             │
│  Channel Layer (src/channels/)                                      │
│  ├── plugins/ (通道插件)                                             │
│  │   ├── telegram.ts                                                │
│  │   ├── discord.ts                                                 │
│  │   ├── slack.ts                                                   │
│  │   └── ...                                                        │
│  └── channel-config.ts (配置解析)                                    │
│       ↓                                                             │
│  Agent Layer (src/agents/)                                          │
│  ├── pi-embedded-runner/ (Pi 运行时)                                 │
│  ├── skills/ (技能系统)                                              │
│  └── subagent-registry.ts (子代理注册)                               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      Nuwax-Agent Electron                           │
├─────────────────────────────────────────────────────────────────────┤
│  Electron Main Process                                              │
│  ├── IPC Handlers (40+ handlers)                                    │
│  │   └── agentHandlers.ts                                           │
│  ├── Services                                                       │
│  │   ├── engines/unifiedAgent.ts                                    │
│  │   ├── engines/acp/acpEngine.ts                                   │
│  │   └── system/dependencies.ts                                     │
│  └── DB (SQLite)                                                    │
│       ↓ IPC 通信                                                     │
│  Electron Renderer Process                                          │
│  ├── Components (React 18 + Ant Design)                             │
│  ├── Services                                                       │
│  │   ├── renderer/permissions.ts                                    │
│  │   └── renderer/sandbox.ts                                        │
│  └── State (useState)                                               │
│       ↓ 调用                                                         │
│  nuwax-agent-core (Rust)                                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块对比

| 维度 | openclaw | Nuwax-Agent Electron |
|------|----------|----------------------|
| **入口点** | `openclaw.mjs` → `buildProgram()` | `main.ts` → `App.tsx` |
| **命令系统** | `command-registry.ts` (动态注册) | IPC Handlers (分散) |
| **通道管理** | `channel-config.ts` (统一解析) | 无对应模块 |
| **事件系统** | Gateway WebSocket (集中式) | IPC + EventEmitter (分散) |
| **插件系统** | `plugins/registry.ts` (统一注册) | 无对应模块 |
| **配置管理** | Zod Schema 验证 | TypeScript 接口 |

---

## 3. 可借鉴的设计模式

### 3.1 命令注册系统

#### openclaw 实现

**源文件**: `src/cli/program/command-registry.ts:14-17, 40-205`

```typescript
// 命令注册类型定义
export type CommandRegistration = {
  id: string;
  register: (params: CommandRegisterParams) => void;
};

type CoreCliEntry = {
  commands: CoreCliCommandDescriptor[];
  register: (params: CommandRegisterParams) => Promise<void> | void;
};

// 核心命令注册表
const coreEntries: CoreCliEntry[] = [
  {
    commands: [
      {
        name: "setup",
        description: "Initialize local config and agent workspace",
        hasSubcommands: false,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("./register.setup.js");
      mod.registerSetupCommand(program);
    },
  },
  {
    commands: [
      {
        name: "agent",
        description: "Run one agent turn via the Gateway",
        hasSubcommands: false,
      },
      {
        name: "agents",
        description: "Manage isolated agents (workspaces, auth, routing)",
        hasSubcommands: true,
      },
    ],
    register: async ({ program, ctx }) => {
      const mod = await import("./register.agent.js");
      mod.registerAgentCommands(program, {
        agentChannelOptions: ctx.agentChannelOptions,
      });
    },
  },
  // ... 更多命令
];

// 懒加载命令注册
function registerLazyCoreCommand(
  program: Command,
  ctx: ProgramContext,
  entry: CoreCliEntry,
  command: CoreCliCommandDescriptor,
) {
  const placeholder = program.command(command.name).description(command.description);
  placeholder.allowUnknownOption(true);
  placeholder.action(async (...actionArgs) => {
    removeEntryCommands(program, entry);
    await entry.register({ program, ctx, argv: process.argv });
    await reparseProgramFromActionArgs(program, actionArgs);
  });
}
```

**设计要点**:
- 命令注册与实现分离
- 懒加载减少启动时间
- 统一的命令描述结构
- 支持子命令嵌套

#### Nuwax Agent 现状

**源文件**: `src/main/ipc/agentHandlers.ts:7-323`

```typescript
// IPC 处理器直接定义
export function registerAgentHandlers(): void {
  ipcMain.handle('agent:init', async (_, config: AgentConfig) => { ... });
  ipcMain.handle('agent:prompt', async (_, sessionId, parts, opts) => { ... });
  ipcMain.handle('agent:abort', async (_, sessionId) => { ... });
  // ... 40+ handlers 散落在各处
}
```

**问题**:
- 无统一的命令/处理器注册机制
- 缺少元数据描述
- 难以实现懒加载

---

### 3.2 通道配置解析

#### openclaw 实现

**源文件**: `src/channels/channel-config.ts:60-164`

```typescript
// 通道匹配来源类型
export type ChannelMatchSource = "direct" | "parent" | "wildcard";

export type ChannelEntryMatch<T> = {
  entry?: T;
  key?: string;
  wildcardEntry?: T;
  wildcardKey?: string;
  parentEntry?: T;
  parentKey?: string;
  matchKey?: string;
  matchSource?: ChannelMatchSource;
};

// 解析通道配置（支持通配符和父级继承）
export function resolveChannelEntryMatchWithFallback<T>(params: {
  entries?: Record<string, T>;
  keys: string[];
  parentKeys?: string[];
  wildcardKey?: string;
  normalizeKey?: (value: string) => string;
}): ChannelEntryMatch<T> {
  // 1. 直接匹配
  const direct = resolveChannelEntryMatch({
    entries: params.entries,
    keys: params.keys,
    wildcardKey: params.wildcardKey,
  });

  if (direct.entry && direct.key) {
    return { ...direct, matchKey: direct.key, matchSource: "direct" };
  }

  // 2. 标准化键匹配
  const normalizeKey = params.normalizeKey;
  if (normalizeKey) {
    const normalizedKeys = params.keys.map((key) => normalizeKey(key)).filter(Boolean);
    if (normalizedKeys.length > 0) {
      for (const [entryKey, entry] of Object.entries(params.entries ?? {})) {
        const normalizedEntry = normalizeKey(entryKey);
        if (normalizedEntry && normalizedKeys.includes(normalizedEntry)) {
          return {
            ...direct,
            entry,
            key: entryKey,
            matchKey: entryKey,
            matchSource: "direct",
          };
        }
      }
    }
  }

  // 3. 父级继承匹配
  const parentKeys = params.parentKeys ?? [];
  if (parentKeys.length > 0) {
    const parent = resolveChannelEntryMatch({ entries: params.entries, keys: parentKeys });
    if (parent.entry && parent.key) {
      return {
        ...direct,
        entry: parent.entry,
        key: parent.key,
        parentEntry: parent.entry,
        parentKey: parent.key,
        matchKey: parent.key,
        matchSource: "parent",
      };
    }
  }

  // 4. 通配符匹配
  if (direct.wildcardEntry && direct.wildcardKey) {
    return {
      ...direct,
      entry: direct.wildcardEntry,
      key: direct.wildcardKey,
      matchKey: direct.wildcardKey,
      matchSource: "wildcard",
    };
  }

  return direct;
}
```

**设计要点**:
- 多级匹配策略 (direct → normalize → parent → wildcard)
- 类型安全的配置解析
- 支持配置继承和覆盖
- 可追溯的匹配来源

---

### 3.3 Gateway 服务器架构

#### openclaw 实现

**源文件**: `src/gateway/server.impl.ts:1-150`

```typescript
export type GatewayServerOptions = {
  /**
   * Bind address policy for the Gateway WebSocket/HTTP server.
   * - loopback: 127.0.0.1
   * - lan: 0.0.0.0
   * - tailnet: bind only to the Tailscale IPv4 address (100.64.0.0/10)
   * - auto: prefer loopback, else LAN
   */
  bind?: import("../config/config.js").GatewayBindMode;
  host?: string;
  controlUiEnabled?: boolean;
  openAiChatCompletionsEnabled?: boolean;
  openResponsesEnabled?: boolean;
  auth?: import("../config/config.js").GatewayAuthConfig;
  // ...
};

export type GatewayServer = {
  close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
};

export async function startGatewayServer(options: GatewayServerOptions): Promise<GatewayServer> {
  // 1. 初始化配置和依赖
  const deps = createDefaultDeps();
  const config = await loadConfig();

  // 2. 初始化插件系统
  const pluginRegistry = createEmptyPluginRegistry();

  // 3. 初始化通道管理器
  const channelManager = await createChannelManager(/* ... */);

  // 4. 初始化 WebSocket 服务器
  const wss = new WebSocketServer({ /* ... */ });

  // 5. 注册 RPC 方法
  const methods = coreGatewayHandlers(/* ... */);

  // 6. 启动健康监控
  startChannelHealthMonitor(/* ... */);

  // 7. 启动配置热重载
  startGatewayConfigReloader(/* ... */);

  // ...
}
```

**设计要点**:
- 模块化的服务器组件
- 清晰的生命周期管理
- 热重载支持
- 健康监控集成

---

### 3.4 程序构建器模式

#### openclaw 实现

**源文件**: `src/cli/program/build-program.ts:8-20`

```typescript
export function buildProgram() {
  const program = new Command();
  const ctx = createProgramContext();
  const argv = process.argv;

  // 设置程序上下文
  setProgramContext(program, ctx);

  // 配置帮助系统
  configureProgramHelp(program, ctx);

  // 注册预执行钩子
  registerPreActionHooks(program, ctx.programVersion);

  // 注册命令
  registerProgramCommands(program, ctx, argv);

  return program;
}
```

**说明**: 以下 `context` 结构为设计抽象，用于迁移思路说明；不是对 openclaw 某个具体文件的逐行引用。

```typescript
export type ProgramContext = {
  programVersion: string;
  agentChannelOptions: AgentChannelOptions;
  // ...
};

export function createProgramContext(): ProgramContext {
  return {
    programVersion: readPackageVersion(),
    agentChannelOptions: parseAgentChannelOptions(),
    // ...
  };
}
```

**设计要点**:
- 上下文与程序分离
- 可测试的构建流程
- 统一的配置入口

---

## 4. 具体改进建议

### 4.1 统一 IPC 处理器注册系统

#### 目标

参考 openclaw 的 `command-registry.ts`，建立统一的 IPC 处理器注册机制。

#### 建议实现

```typescript
// src/main/ipc/registry.ts
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';

/**
 * IPC 处理器注册类型
 * 参考: openclaw/src/cli/program/command-registry.ts:14-17
 */
export type IpcHandlerEntry = {
  id: string;
  handlers: IpcHandlerDescriptor[];
  load: (deps: IpcDependencies) => Promise<IpcHandlerModule>;
};

export type IpcHandlerDescriptor = {
  channel: string;
  description: string;
  hasResponse: boolean; // true: ipcMain.handle, false: ipcMain.on
};

/**
 * IPC 依赖上下文
 */
export type IpcDependencies = {
  agentService: UnifiedAgentService;
  db: Database;
  configManager: ConfigManager;
  // ...
};

export type IpcInvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown;
export type IpcEventHandler = (event: IpcMainEvent, ...args: unknown[]) => Promise<void> | void;

export type IpcHandlerModule = {
  invoke: Record<string, IpcInvokeHandler>;
  events?: Record<string, IpcEventHandler>;
};

/**
 * 核心 IPC 处理器注册表
 * 参考: openclaw/src/cli/program/command-registry.ts:40-205
 */
const coreIpcEntries: IpcHandlerEntry[] = [
  {
    id: 'agent',
    handlers: [
      {
        channel: 'agent:init',
        description: 'Initialize agent service with config',
        hasResponse: true,
      },
      {
        channel: 'agent:destroy',
        description: 'Destroy agent service',
        hasResponse: true,
      },
      {
        channel: 'agent:prompt',
        description: 'Send prompt to agent (blocking)',
        hasResponse: true,
      },
      {
        channel: 'agent:promptAsync',
        description: 'Send prompt to agent (non-blocking)',
        hasResponse: true,
      },
    ],
    load: async ({ agentService }) => {
      const mod = await import('./handlers/agent-handlers.js');
      return mod.createAgentHandlers({ agentService });
    },
  },
  {
    id: 'session',
    handlers: [
      {
        channel: 'session:create',
        description: 'Create a new session',
        hasResponse: true,
      },
      {
        channel: 'session:list',
        description: 'List all sessions',
        hasResponse: true,
      },
    ],
    load: async ({ db }) => {
      const mod = await import('./handlers/session-handlers.js');
      return mod.createSessionHandlers({ db });
    },
  },
  // ... 更多处理器组
];

const loadedModules = new Map<string, IpcHandlerModule>();
const loadingPromises = new Map<string, Promise<IpcHandlerModule>>();

async function ensureEntryLoaded(entry: IpcHandlerEntry, deps: IpcDependencies): Promise<IpcHandlerModule> {
  const loaded = loadedModules.get(entry.id);
  if (loaded) return loaded;

  const loading = loadingPromises.get(entry.id);
  if (loading) return loading;

  const promise = entry
    .load(deps)
    .then((mod) => {
      loadedModules.set(entry.id, mod);
      return mod;
    })
    .finally(() => {
      loadingPromises.delete(entry.id);
    });

  loadingPromises.set(entry.id, promise);
  return promise;
}

/**
 * 懒加载 IPC 处理器注册
 * 参考: openclaw/src/cli/program/command-registry.ts:241-255
 */
function registerLazyIpcHandler(
  entry: IpcHandlerEntry,
  deps: IpcDependencies,
  ipc: typeof ipcMain,
) {
  // 注册稳定的代理处理器，首次调用时加载真实模块。
  // 避免在回调内重复 ipcMain.handle()，防止重复注册和语义错误。
  for (const handler of entry.handlers) {
    if (handler.hasResponse) {
      ipc.handle(handler.channel, async (event, ...args) => {
        const mod = await ensureEntryLoaded(entry, deps);
        const fn = mod.invoke[handler.channel];
        if (!fn) {
          throw new Error(`[IPC] Missing invoke handler: ${handler.channel} (entry: ${entry.id})`);
        }
        return fn(event, ...args);
      });
    } else {
      ipc.on(handler.channel, async (event, ...args) => {
        try {
          const mod = await ensureEntryLoaded(entry, deps);
          const fn = mod.events?.[handler.channel];
          if (!fn) {
            throw new Error(`[IPC] Missing event handler: ${handler.channel} (entry: ${entry.id})`);
          }
          await fn(event, ...args);
        } catch (error) {
          log.error('[IPC] Lazy event handler failed:', handler.channel, error);
        }
      });
    }
  }
}

/**
 * 构建所有 IPC 处理器
 */
export function buildIpcHandlers(deps: IpcDependencies) {
  for (const entry of coreIpcEntries) {
    registerLazyIpcHandler(entry, deps, ipcMain);
  }
}

/**
 * 获取所有已注册的 IPC 通道描述
 */
export function getIpcHandlerDescriptions(): Array<{ channel: string; description: string }> {
  return coreIpcEntries.flatMap((entry) =>
    entry.handlers.map((h) => ({ channel: h.channel, description: h.description }))
  );
}
```

---

### 4.2 配置解析系统

#### 目标

参考 openclaw 的 `channel-config.ts`，建立统一的配置解析机制。

#### 建议实现

```typescript
// src/services/common/config-resolver.ts

/**
 * 配置匹配来源
 * 参考: openclaw/src/channels/channel-config.ts:1-12
 */
export type ConfigMatchSource = "direct" | "parent" | "wildcard" | "default";

export type ConfigEntryMatch<T> = {
  entry?: T;
  key?: string;
  wildcardEntry?: T;
  wildcardKey?: string;
  parentEntry?: T;
  parentKey?: string;
  defaultEntry?: T;
  defaultKey?: string;
  matchKey?: string;
  matchSource?: ConfigMatchSource;
};

/**
 * 解析配置项（支持多级匹配）
 * 参考: openclaw/src/channels/channel-config.ts:82-164
 */
export function resolveConfigEntryMatch<T>(params: {
  entries?: Record<string, T>;
  keys: string[];
  parentKeys?: string[];
  wildcardKey?: string;
  defaultKey?: string;
  normalizeKey?: (value: string) => string;
}): ConfigEntryMatch<T> {
  const entries = params.entries ?? {};
  const match: ConfigEntryMatch<T> = {};

  // 1. 直接匹配
  for (const key of params.keys) {
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      match.entry = entries[key];
      match.key = key;
      match.matchKey = key;
      match.matchSource = "direct";
      return match;
    }
  }

  // 2. 标准化键匹配
  const normalizeKey = params.normalizeKey;
  if (normalizeKey) {
    const normalizedKeys = params.keys.map(normalizeKey).filter(Boolean);
    for (const [entryKey, entry] of Object.entries(entries)) {
      const normalizedEntry = normalizeKey(entryKey);
      if (normalizedEntry && normalizedKeys.includes(normalizedEntry)) {
        return {
          ...match,
          entry,
          key: entryKey,
          matchKey: entryKey,
          matchSource: "direct",
        };
      }
    }
  }

  // 3. 父级继承
  const parentKeys = params.parentKeys ?? [];
  for (const key of parentKeys) {
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      return {
        ...match,
        entry: entries[key],
        key,
        parentEntry: entries[key],
        parentKey: key,
        matchKey: key,
        matchSource: "parent",
      };
    }
  }

  // 4. 通配符匹配
  if (params.wildcardKey && Object.prototype.hasOwnProperty.call(entries, params.wildcardKey)) {
    return {
      ...match,
      entry: entries[params.wildcardKey],
      key: params.wildcardKey,
      wildcardEntry: entries[params.wildcardKey],
      wildcardKey: params.wildcardKey,
      matchKey: params.wildcardKey,
      matchSource: "wildcard",
    };
  }

  // 5. 默认值
  if (params.defaultKey && Object.prototype.hasOwnProperty.call(entries, params.defaultKey)) {
    return {
      ...match,
      entry: entries[params.defaultKey],
      key: params.defaultKey,
      defaultEntry: entries[params.defaultKey],
      defaultKey: params.defaultKey,
      matchKey: params.defaultKey,
      matchSource: "default",
    };
  }

  return match;
}

/**
 * 权限配置解析器
 */
export class PermissionConfigResolver {
  private readonly entries: Record<string, PermissionConfig>;

  constructor(config: AppConfig) {
    this.entries = config.permissions ?? {};
  }

  resolve(sessionId: string, workspaceId: string): PermissionConfig {
    const match = resolveConfigEntryMatch<PermissionConfig>({
      entries: this.entries,
      keys: [sessionId],
      parentKeys: [workspaceId],
      wildcardKey: "*",
      defaultKey: "default",
    });

    return match.entry ?? this.getDefaultPermission();
  }

  private getDefaultPermission(): PermissionConfig {
    return {
      'tool:read': 'allow',
      'tool:edit': 'prompt',
      'command:bash': 'prompt',
      'file:read': 'allow',
      'file:write': 'prompt',
      'network:http': 'prompt',
    };
  }
}
```

---

### 4.3 程序上下文模式

#### 目标

参考 openclaw 的 `build-program.ts` 和 `context.ts`，建立统一的程序上下文。

#### 建议实现

```typescript
// src/main/context.ts
import { app } from 'electron';
import * as path from 'path';
import { APP_DATA_DIR_NAME } from './services/constants';

/**
 * 程序上下文
 * 参考: openclaw/src/cli/program/build-program.ts:8-20
 */
export type ProgramContext = {
  // 版本信息
  version: string;

  // 路径信息（必须与项目约束一致：~/.nuwaclaw）
  paths: {
    homeDir: string;
    appDataDir: string;
    dbPath: string;
    logsDir: string;
  };

  // 服务实例
  services: {
    agent: UnifiedAgentService;
    db: Database;
    config: ConfigManager;
    permissions: PermissionManager;
    sandbox: SandboxManager;
  };

  // 运行时配置
  runtime: {
    isDev: boolean;
    platform: NodeJS.Platform;
    appPath: string;
    packaged: boolean;
  };
};

function resolveAppPaths() {
  const homeDir = app.getPath('home');
  const appDataDir = path.join(homeDir, APP_DATA_DIR_NAME);
  return {
    homeDir,
    appDataDir,
    dbPath: path.join(appDataDir, 'nuwaclaw.db'),
    logsDir: path.join(appDataDir, 'logs'),
  };
}

/**
 * 创建默认程序上下文
 */
export async function createProgramContext(): Promise<ProgramContext> {
  const paths = resolveAppPaths();

  // 初始化服务
  const config = await ConfigManager.create(paths.appDataDir);
  const db = await Database.create(paths.dbPath);
  const permissions = new PermissionManager(config);
  const sandbox = new SandboxManager(config);
  const agent = new UnifiedAgentService();

  return Object.freeze({
    version: app.getVersion(),
    paths,
    services: {
      agent,
      db,
      config,
      permissions,
      sandbox,
    },
    runtime: {
      isDev: !app.isPackaged,
      platform: process.platform,
      appPath: app.getAppPath(),
      packaged: app.isPackaged,
    },
  });
}

/**
 * 说明：
 * - ProgramContext 仅保存“稳定依赖”（路径、服务、运行时信息）
 * - 会话态（activeSessionId、UI 选择态）放到 SessionStore/Renderer state，不放在全局上下文中
 */
class ProgramContextManager {
  private context: ProgramContext | null = null;

  async init(): Promise<ProgramContext> {
    if (this.context) return this.context;
    this.context = await createProgramContext();
    return this.context;
  }

  get(): ProgramContext {
    if (!this.context) {
      throw new Error('Program context not initialized');
    }
    return this.context;
  }

  async dispose(): Promise<void> {
    if (!this.context) return;
    await this.context.services.agent.destroy().catch(() => undefined);
    await this.context.services.db.close().catch(() => undefined);
    this.context = null;
  }
}

export const programContextManager = new ProgramContextManager();
```

---

### 4.4 统一事件系统

#### 目标

参考 openclaw 的 Gateway 事件系统，建立统一的事件总线。

#### 建议实现

```typescript
// src/services/common/event-bus.ts

/**
 * 事件类型定义
 */
export enum EventType {
  // Agent 事件
  AGENT_INITIALIZED = 'agent:initialized',
  AGENT_DESTROYED = 'agent:destroyed',
  AGENT_ERROR = 'agent:error',

  // Session 事件
  SESSION_CREATED = 'session:created',
  SESSION_UPDATED = 'session:updated',
  SESSION_DELETED = 'session:deleted',

  // Message 事件
  MESSAGE_RECEIVED = 'message:received',
  MESSAGE_UPDATED = 'message:updated',
  MESSAGE_SENT = 'message:sent',

  // Permission 事件
  PERMISSION_REQUIRED = 'permission:required',
  PERMISSION_GRANTED = 'permission:granted',
  PERMISSION_DENIED = 'permission:denied',
}

/**
 * 事件数据接口
 */
export interface EventData<T = unknown> {
  type: EventType;
  timestamp: number;
  source?: string;
  payload: T;
}

/**
 * 事件监听器
 */
export type EventListener<T = unknown> = (event: EventData<T>) => void | Promise<void>;

/**
 * 统一事件总线
 * 参考: openclaw 的 Gateway WebSocket 事件系统
 */
export class EventBus {
  private listeners: Map<EventType, Set<EventListener>> = new Map();
  private eventQueue: EventData[] = [];
  private isDraining: boolean = false;
  private drainScheduled: boolean = false;
  private maxQueueSize: number = 1000;

  private static instance: EventBus;

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * 订阅事件
   */
  on<T>(type: EventType, listener: EventListener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener as EventListener);

    // 返回取消订阅函数
    return () => this.off(type, listener);
  }

  /**
   * 取消订阅
   */
  off<T>(type: EventType, listener: EventListener<T>): void {
    this.listeners.get(type)?.delete(listener as EventListener);
  }

  /**
   * 发送事件（立即）
   */
  async emit<T>(type: EventType, payload: T, source?: string): Promise<void> {
    const event: EventData<T> = {
      type,
      timestamp: Date.now(),
      source,
      payload,
    };

    const listeners = this.listeners.get(type);
    if (!listeners || listeners.size === 0) {
      return;
    }

    const settled = await Promise.allSettled(
      [...listeners].map((listener) => Promise.resolve().then(() => listener(event)))
    );

    settled.forEach((result) => {
      if (result.status === 'rejected') {
        console.error(`[EventBus] Listener error for ${type}:`, result.reason);
      }
    });
  }

  /**
   * 发送事件（同步 fire-and-forget）
   * 适用于不要求调用方等待监听器执行结果的场景
   */
  emitNow<T>(type: EventType, payload: T, source?: string): void {
    void this.emit(type, payload, source).catch((error) => {
      console.error(`[EventBus] emitNow failed for ${type}:`, error);
    });
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;

    queueMicrotask(() => {
      this.drainScheduled = false;
      void this.drainQueue().catch((error) => {
        console.error('[EventBus] drainQueue failed:', error);
      });
    });
  }

  private async drainQueue(maxMs: number = 100): Promise<number> {
    if (this.isDraining || this.eventQueue.length === 0) {
      return 0;
    }

    this.isDraining = true;
    const startTime = Date.now();
    let processed = 0;

    try {
      while (this.eventQueue.length > 0 && Date.now() - startTime < maxMs) {
        const event = this.eventQueue.shift();
        if (!event) continue;
        await this.emit(event.type, event.payload, event.source);
        processed++;
      }

      // 时间片耗尽但队列还有数据，安排下一轮，避免阻塞主循环
      if (this.eventQueue.length > 0) {
        this.scheduleDrain();
      }
    } finally {
      this.isDraining = false;
    }

    return processed;
  }

  /**
   * 发送异步事件（进入队列并自动调度处理）
   */
  emitAsync<T>(type: EventType, payload: T, source?: string): void {
    if (this.eventQueue.length >= this.maxQueueSize) {
      console.warn('[EventBus] Event queue overflow, dropping oldest event');
      this.eventQueue.shift();
    }

    this.eventQueue.push({
      type,
      timestamp: Date.now(),
      source,
      payload,
    });
    this.scheduleDrain();
  }

  /**
   * 主动 flush：用于测试或退出前确保队列处理完
   */
  async flush(): Promise<void> {
    while (this.eventQueue.length > 0 || this.isDraining) {
      await this.drainQueue(100);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.eventQueue = [];
  }

  /**
   * 获取队列大小
   */
  getQueueSize(): number {
    return this.eventQueue.length;
  }
}

// 全局实例
export const eventBus = EventBus.getInstance();
```

---

### 4.5 Lobster Runtime 集成（openclaw + lobsterAI）

#### 目标

在不替换现有 ACP 引擎层的前提下，引入 Lobster 的“可恢复工作流”能力（`run/resume`），用于长链路、可审计、可回放的任务执行。

#### 建议实现

```typescript
// src/main/services/workflow/lobsterRuntime.ts

export type LobsterRunConfig = {
  workspaceDir: string;
  prompt: string;
  pipeline?: string;
  profile: 'strict' | 'compat';
};

export type LobsterRunResult = {
  runId: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  resumeToken?: string;
  output?: string;
  error?: string;
};

export interface LobsterRuntime {
  run(config: LobsterRunConfig): Promise<LobsterRunResult>;
  resume(runId: string, input?: string): Promise<LobsterRunResult>;
  getStatus(runId: string): Promise<LobsterRunResult>;
}
```

```typescript
// src/main/ipc/handlers/lobster-handlers.ts
ipcMain.handle('lobster:run', async (_, config) => lobsterRuntime.run(config));
ipcMain.handle('lobster:resume', async (_, runId, input) => lobsterRuntime.resume(runId, input));
ipcMain.handle('lobster:status', async (_, runId) => lobsterRuntime.getStatus(runId));
```

```sql
-- SQLite: workflow_runs
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  engine TEXT NOT NULL,            -- 'lobster'
  profile TEXT NOT NULL,           -- strict | compat
  workspace_dir TEXT NOT NULL,
  status TEXT NOT NULL,            -- running | paused | completed | failed
  resume_token TEXT,
  pipeline_hash TEXT,
  last_output TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### 环境变量策略（解决“过严限制导致动态安装失败”）

- `strict`（默认）：维持当前隔离策略（`PATH/NODE_PATH/HOME/XDG` 受控），适用于生产稳定性和安全优先。
- `compat`（可切换）：在 `strict` 基础上允许有限透传，降低动态安装/企业网络失败率。
  - 必须透传：`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`
  - 可选透传（按白名单配置）：`PIP_INDEX_URL`, `UV_DEFAULT_INDEX`, `GIT_ASKPASS`, `SSH_AUTH_SOCK`
  - 禁止透传（仍由应用控制）：`CLAUDE_*`, `ANTHROPIC_*`, `OPENAI_*`, `NPM_CONFIG_PREFIX`

推荐实现：新增 `buildRuntimeEnv(profile, passthroughAllowlist)`，由 `dependencies.ts/getAppEnv()`、`acpClient.ts`、`mcp.ts` 统一调用，避免各模块各自拼接 env。

详细规则与迁移步骤见：

- `docs/architecture/RUNTIME-ENV-PROFILES.md`

---

## 5. 实施路线图

### 5.1 优先级矩阵

| 优先级 | 改进项 | 难度 | 预期价值 | 涉及文件 |
|--------|--------|------|----------|----------|
| 🔴 P0 | 统一 IPC 注册系统（稳定代理 + 一次加载） | 中 | 高 | `src/main/ipc/*` |
| 🔴 P0 | 程序上下文模式（路径约束对齐 `~/.nuwaclaw`） | 中 | 高 | `src/main/context.ts` |
| 🔴 P0 | 运行时环境双模式（strict/compat） | 中 | 高 | `src/main/services/system/*` |
| 🟡 P1 | 统一事件总线 | 中 | 高 | `src/services/common/event-bus.ts` |
| 🟡 P1 | Lobster Runtime 集成（run/resume） | 中 | 高 | `src/main/services/workflow/*` |
| 🟡 P1 | 配置解析系统 | 中 | 中 | `src/services/common/config-resolver.ts` |
| 🟢 P2 | 文档和类型定义 | 低 | 中 | `src/shared/types/*` |

### 5.2 实施步骤

#### Phase 1: 基础架构 (Week 1)

1. **创建程序上下文**
   - 新建 `src/main/context.ts`
   - 路径统一到 `app.getPath('home') + '/.nuwaclaw'`
   - 重构 `main.ts` 使用上下文
   - 提取服务初始化逻辑

2. **统一 IPC 注册**
   - 新建 `src/main/ipc/registry.ts`
   - 使用“稳定代理 + 动态模块加载”模式，避免重复 `ipcMain.handle`
   - 重构现有 handlers 使用注册表
   - 添加处理器元数据

3. **环境双模式重构**
   - 新建 `src/main/services/system/runtimeEnv.ts`
   - 抽取 `strict/compat` 两套策略和白名单透传
   - 统一替换 `dependencies.ts`、`acpClient.ts`、`mcp.ts` 的 env 拼接逻辑

#### Phase 2: 事件系统 (Week 2)

1. **实现事件总线**
   - 新建 `src/services/common/event-bus.ts`
   - 定义事件类型枚举
   - `emit` 捕获异步监听器异常，`emitAsync` 自动调度 drain
   - 重构 `unifiedAgent.ts` 使用事件总线

2. **配置解析**
   - 新建 `src/services/common/config-resolver.ts`
   - 实现多级匹配策略
   - 重构权限配置使用解析器

3. **Lobster Runtime 集成**
   - 新建 `src/main/services/workflow/lobsterRuntime.ts`
   - 增加 `lobster:run/resume/status` IPC
   - 新增 `workflow_runs` 表并接入状态持久化

#### Phase 3: 集成测试 (Week 3)

1. **添加单元测试**
2. **性能测试和优化**
3. **文档更新**

### 5.3 兼容性考虑

- 保持现有 IPC API 不变（使用适配器模式）
- 保持数据目录约束不变：所有持久化数据继续落在 `~/.nuwaclaw/`
- 默认使用 `strict`，仅在显式配置下切换到 `compat`
- 分阶段迁移，不破坏现有功能
- 添加废弃警告，逐步过渡

---

## 附录

### A. openclaw 源码位置

| 模块 | 文件路径 |
|------|----------|
| 命令注册 | `src/cli/program/command-registry.ts` |
| 程序构建 | `src/cli/program/build-program.ts` |
| 通道配置 | `src/channels/channel-config.ts` |
| Gateway 服务器 | `src/gateway/server.impl.ts` |
| 插件系统 | `src/plugins/registry.ts` |

### B. Nuwax Agent 源码位置

| 模块 | 文件路径 |
|------|----------|
| Agent Handlers | `src/main/ipc/agentHandlers.ts` |
| UnifiedAgentService | `src/main/services/engines/unifiedAgent.ts` |
| AcpEngine | `src/main/services/engines/acp/acpEngine.ts` |
| Permissions | `src/renderer/services/permissions.ts` |
| Sandbox | `src/renderer/services/sandbox.ts` |

### C. 参考资料

- [openclaw GitHub Repository](https://github.com/openclaw/openclaw)
- [Commander.js Documentation](https://github.com/tj/commander.js)
- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/tutorial/ipc)
- `docs/architecture/RUNTIME-ENV-PROFILES.md`

---

*文档版本: 2.3*
*最后更新: 2026-02-24*
