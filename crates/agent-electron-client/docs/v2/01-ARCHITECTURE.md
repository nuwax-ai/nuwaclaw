---
version: 2.0
last-updated: 2026-03-09
status: design
---

# 01 — 总体架构

## 一、产品定位

**女娲智能体 OS (Nuwax Agent OS)** 是全球首个开源通用智能体操作系统，支持用户完整私有化部署。
用户部署后即拥有一个完整的 Agent 服务（如 `https://testagent.xspaceagi.com`），
具备 Agent 配置、模型管理、技能管理、MCP、知识库、工作流、插件、会话等全套能力。

**NuwaClaw（Electron 客户端）** 是 Nuwax Agent OS 的**桌面增强体**：

- 运行在**用户电脑**或**云电脑**上（如云桌面、远程 VM）
- **侧重使用和便捷配置**——不是复制服务器全部功能，而是提供一体化的 Agent 使用体验
- 提供本地代码执行、引擎管理、IM Channel 网关等服务器不具备的桌面级能力
- 与 Nuwax Agent OS 服务深度同步，是 Agent 服务在终端计算节点的延伸
- 未来支持**手机端操控**——通过服务器 Web API 实现跨设备管理

```
┌──────────────────────────────────────────────────────────────────────┐
│  Nuwax Agent OS（用户私有部署）                                        │
│  https://testagent.xspaceagi.com                                     │
│                                                                      │
│  • Agent 配置 & 组件管理       • 模型管理                              │
│  • 技能管理 & MCP 管理          • 会话 & 消息                          │
│  • 知识库 (RAG) & 工作流        • 插件管理                             │
│  • 沙箱环境 & 计算资源          • 用户权限 & 审计                      │
│                                                                      │
│            ↕  API 同步 (/api/model/*, /api/skill/*, ...)             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  NuwaClaw Client — 桌面增强体（用户电脑 / 云电脑）              │  │
│  │                                                                │  │
│  │  • 引擎管理 (ACP 子进程)      • 本地代码执行                    │  │
│  │  • MCP Server 本地运行        • IM Channel 网关                │  │
│  │  • 离线缓存 & 离线使用         • Agent 自我进化 (本地记忆)       │  │
│  │  • 系统级权限 (文件/网络)      • 与服务器双向同步               │  │
│  │  • 知识库/工作流/插件便捷配置  • 一体化使用 + 手机可操控         │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 二、分层架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        UI 层 (Renderer Process)                          │
│  React + Ant Design · 会话界面 · 设置面板 · 技能市场 · Agent 仪表盘       │
└──────────────────────────────────────────────────────────────────────────┘
                                     ↕ IPC
┌──────────────────────────────────────────────────────────────────────────┐
│                     服务网关层 (Main Process)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ ModelGateway │  │ ChatEngine   │  │ ToolEngine   │  │ ChannelGW    │ │
│  │ 多模型路由    │  │ 会话引擎      │  │ Skill+MCP    │  │ IM 网关      │ │
│  │              │  │              │  │ +Plugin+WF   │  │              │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │                 │         │
│  ┌──────▼─────────────────▼─────────────────▼─────────────────▼───────┐ │
│  │                  ServiceOrchestrator (编排层)                        │ │
│  │   统一生命周期管理 · 依赖注入 · 健康检查 · 可观测性                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                     ↕                                   │
│  ┌──────────────────────┐  ┌──────────────────────────────────────────┐ │
│  │  Nuwax Sync Layer    │  │  本地存储层 (Persistence)                  │ │
│  │  NuwaxApiClient      │  │  SQLite · Markdown · KeyStore            │ │
│  │  + 各领域 Adapter    │  │                                          │ │
│  └──────────────────────┘  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                                     ↕ HTTP/WS
┌──────────────────────────────────────────────────────────────────────────┐
│                     Agent 引擎层 (子进程 / ACP)                           │
│  claude-code · nuwaxcode · 本地 LLM                                      │
└──────────────────────────────────────────────────────────────────────────┘
                                     ↕ HTTP
┌──────────────────────────────────────────────────────────────────────────┐
│                  Nuwax Agent OS (用户私有部署服务)                         │
│  https://testagent.xspaceagi.com                                         │
│  /api/model/* · /api/skill/* · /api/mcp/* · /api/agent/* ·               │
│  /api/knowledge/* · /api/workflow/* · /api/plugin/* · ...                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 三、核心组件

### 3.1 NuwaxApiClient（API 客户端）

所有 Sync Adapter 的底层 HTTP 客户端，负责认证、请求/响应处理和错误重试：

```typescript
class NuwaxApiClient {
  private baseUrl: string;
  private authToken: string;
  private spaceId: number;

  constructor(config: {
    baseUrl: string; // https://testagent.xspaceagi.com
    spaceId: number;
  }) {}

  /** 认证登录，获取 token */
  async authenticate(credentials: {
    username: string;
    password: string;
  }): Promise<void>;

  /** 使用 API Token 认证 */
  async authenticateWithToken(token: string): Promise<void>;

  /** 通用请求方法，自动携带 auth 头 + 错误重试 */
  async request<T>(
    method: "GET" | "POST",
    path: string,
    data?: unknown,
    options?: {
      retries?: number;
      timeout?: number;
    },
  ): Promise<T>;

  /** 上传文件 */
  async upload(path: string, file: Buffer, filename: string): Promise<unknown>;

  /** 建立 SSE 连接 */
  createSSE(path: string): EventSource;

  /** 连接状态 */
  isConnected(): boolean;

  /** Token 过期自动刷新 */
  private refreshTokenIfNeeded(): Promise<void>;
}
```

### 3.2 NuwaxSyncService（同步层）

与用户部署的 Nuwax Agent OS 服务进行双向同步的协调服务：

```typescript
interface NuwaxSyncService {
  /** 配置服务端点 */
  configure(endpoint: {
    baseUrl: string; // https://testagent.xspaceagi.com
    authToken?: string;
    spaceId: number;
  }): void;

  /** 同步模型配置（从服务器拉 + 本地推） */
  syncModels(): Promise<SyncResult>;

  /** 同步技能/MCP 配置 */
  syncSkillsAndMcp(): Promise<SyncResult>;

  /** 同步知识库配置 */
  syncKnowledge(): Promise<SyncResult>;

  /** 同步工作流定义 */
  syncWorkflows(): Promise<SyncResult>;

  /** 同步插件配置 */
  syncPlugins(): Promise<SyncResult>;

  /** 同步会话和消息 */
  syncConversations(): Promise<SyncResult>;

  /** 同步 Agent 完整配置（含所有组件） */
  syncAgentConfig(agentId: number): Promise<AgentConfigInfo>;

  /** 测试连接 */
  testConnection(): Promise<{
    success: boolean;
    version?: string;
    error?: string;
  }>;

  /** 获取同步状态 */
  getSyncStatus(): SyncStatus;

  /** 设置自动同步 */
  setAutoSync(enabled: boolean, intervalMs?: number): void;
}

interface SyncResult {
  success: boolean;
  pulled: number;
  pushed: number;
  conflicts: SyncConflict[];
  errors?: string[];
}

interface SyncConflict {
  type:
    | "model"
    | "skill"
    | "mcp"
    | "conversation"
    | "knowledge"
    | "workflow"
    | "plugin";
  localItem: unknown;
  serverItem: unknown;
  resolution?: "use-server" | "use-local" | "merge";
}

interface SyncStatus {
  lastSyncAt: number;
  connected: boolean;
  pendingChanges: number;
  syncInProgress: boolean;
  /** 分模块同步时间 */
  moduleSyncStatus: Record<
    string,
    { lastSyncAt: number; status: "ok" | "error" | "pending" }
  >;
}
```

### 3.3 ServiceOrchestrator（编排层）

替代当前 `processManager.ts` + `startup.ts` 的分散管理，提供统一的服务生命周期：

```typescript
interface ServiceOrchestrator {
  /** 注册服务（声明依赖关系） */
  register(service: ServiceDescriptor): void;

  /** 按拓扑序启动所有服务 */
  startAll(): Promise<ServiceStartResult>;

  /** 优雅停机（逆序） */
  stopAll(): Promise<void>;

  /** 健康检查 */
  healthCheck(): Promise<Record<string, HealthStatus>>;

  /** 获取服务实例 */
  getService<T>(name: string): T;
}
```

### 3.4 核心组件一览

| 组件           | 描述                                            | 详细文档                                                                                |
| -------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| ModelGateway   | 多 Provider 管理，与服务器 `/api/model/*` 同步  | [02-MODEL-CONFIG.md](./02-MODEL-CONFIG.md)                                              |
| ChatEngine     | 会话引擎，与服务器 `/api/conversation/*` 同步   | [04-SESSION-CHAT.md](./04-SESSION-CHAT.md)                                              |
| ToolEngine     | 技能 + MCP + Plugin + Workflow 统一工具管理     | [03-SKILLS-MCP.md](./03-SKILLS-MCP.md) / [07-KWP.md](./07-KNOWLEDGE-WORKFLOW-PLUGIN.md) |
| ChannelGateway | 多 IM 平台接入，可路由到服务器 Agent 或本地引擎 | [05-CHANNELS.md](./05-CHANNELS.md)                                                      |
| KnowledgeSync  | 知识库/工作流/插件同步与本地 RAG                | [07-KWP.md](./07-KNOWLEDGE-WORKFLOW-PLUGIN.md)                                          |

---

## 四、客户端与服务器的职责划分

| 能力         | 服务器 (Nuwax Agent OS)    | 客户端 (NuwaClaw · 用户电脑/云电脑) |
| ------------ | -------------------------- | ----------------------------------- |
| Agent 配置   | ✅ 权威来源                | 🔧 便捷配置入口 + 拉取同步          |
| 模型管理     | ✅ CRUD + 连通性测试       | 🔧 便捷配置 + 本地 Provider 扩展    |
| 技能管理     | ✅ CRUD + 发布 + 广场      | 🔄 同步 + Agent 自学技能推送        |
| MCP 管理     | ✅ 配置存储 + 服务端运行   | 🔧 便捷配置 + 本地 MCP Server 运行  |
| 知识库 (RAG) | ✅ 文档管理 + 分段 + 嵌入  | 🔗 配置入口 + 委托服务器执行 RAG    |
| 工作流       | ✅ 节点编排引擎 + 试运行   | 🔗 配置入口 + 委托服务器执行        |
| 插件管理     | ✅ HTTP/Code 插件 + 试运行 | 🔗 配置入口 + 委托服务器执行        |
| 会话管理     | ✅ 服务端会话              | 🔄 双向同步 + 本地引擎会话          |
| 沙箱/计算    | ✅ 云端沙箱                | ✅ 本地引擎 (ACP 子进程)            |
| IM Channel   | ❌                         | ✅ 本地 Channel 网关                |
| 自我进化     | ❌                         | ✅ Memory / EvoMap / Soul           |
| 离线使用     | ❌                         | ✅ 离线缓存可用                     |
| 手机操控     | ✅ Web API                 | 🔗 通过服务器 API 实现手机远程管理  |
| 系统权限     | ❌ (沙箱限制)              | ✅ 文件系统/进程/网络               |

---

## 五、与 V1 的向后兼容

### 保留不变

| 组件                 | 说明                                     |
| -------------------- | ---------------------------------------- |
| 三区隔离模型         | App Core / Agent Workspace / User System |
| ACP 协议栈           | 作为 Agent 引擎层的核心协议              |
| Computer HTTP Server | 保留 `/computer/*` API 兼容              |
| 依赖管理             | Node / uv / 引擎安装逻辑不变             |

### 重构 / 新增

| 组件                         | V1 → V2 变化                              |
| ---------------------------- | ----------------------------------------- |
| `processManager.ts`          | → `ServiceOrchestrator` 统一编排          |
| `computerServer.ts` 内嵌路由 | → 独立 `RouterService` 可插拔             |
| `EngineManager` 双引擎       | → `ModelGateway` 多 Provider + 服务器同步 |
| MCP Proxy (外部进程)         | → MCP 原生集成 + 服务器 MCP 配置同步      |
| 独立会话管理                 | → `ChatEngine` + 服务器会话同步           |
| `IMService` (renderer侧)     | → `ChannelGateway` (main进程 + Worker)    |
| 无同步层                     | → `NuwaxSyncService` 双向同步             |
| 无知识库/工作流/插件         | → 与服务器 Knowledge/Workflow/Plugin 同步 |

---

## 六、服务依赖与启动顺序

### 6.1 服务依赖图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         服务依赖关系图                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  NuwaxApiClient ──────────────────────────────────────────────────────  │
│       │                                                                 │
│       ├──────────► McpManager ──────────────────────────────────────    │
│       │                │                                                │
│       │                └──────────► McpWarmupService                   │
│       │                                                                 │
│       ├──────────► SkillManager                                         │
│       │                                                                 │
│       ├──────────► ModelGateway                                         │
│       │                                                                 │
│       └──────────► NuwaxSyncService                                     │
│                            │                                            │
│                            └──────────► 各领域 SyncAdapter              │
│                                                                         │
│  McpManager + SkillManager                                              │
│       │                                                                 │
│       └──────────► ToolRegistry ────────────────────────────────────    │
│                                                                         │
│  ModelGateway + ToolRegistry                                            │
│       │                                                                 │
│       └──────────► ChatEngine                                           │
│                                                                         │
│  ChatEngine                                                             │
│       │                                                                 │
│       └──────────► ChannelGateway                                       │
│                                                                         │
│  NuwaxApiClient + CronScheduler                                         │
│       │                                                                 │
│       └──────────► HeartbeatEngine                                      │
│                                                                         │
│  CronScheduler ─────────────────────────────────────────────────────    │
│       │                                                                 │
│       └──────────► CronSyncAdapter                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 启动顺序

```typescript
/**
 * 服务启动顺序（按依赖拓扑排序）
 * 
 * 阶段 1: 基础设施
 * 阶段 2: 数据同步（可并行）
 * 阶段 3: 工具注册
 * 阶段 4: 会话引擎
 * 阶段 5: 渠道接入
 * 阶段 6: 后台任务
 */
const SERVICE_START_ORDER = {
  // 阶段 1: 基础设施（串行）
  phase1: [
    { name: "NuwaxApiClient", timeout: 10000 },
    { name: "NuwaxSyncService", timeout: 5000 },
  ],

  // 阶段 2: 数据同步（可并行）
  phase2: [
    { name: "McpManager", timeout: 30000, parallel: true },
    { name: "SkillManager", timeout: 10000, parallel: true },
    { name: "ModelGateway", timeout: 10000, parallel: true },
  ],

  // 阶段 3: MCP 预热（后台）
  phase2_5: [
    { name: "McpWarmupService", timeout: 60000, background: true },
  ],

  // 阶段 3: 工具注册
  phase3: [
    { name: "ToolRegistry", timeout: 5000 },
  ],

  // 阶段 4: 会话引擎
  phase4: [
    { name: "ChatEngine", timeout: 10000 },
  ],

  // 阶段 5: 渠道接入
  phase5: [
    { name: "ChannelGateway", timeout: 5000 },
  ],

  // 阶段 6: 后台任务
  phase6: [
    { name: "HeartbeatEngine", timeout: 5000 },
    { name: "CronScheduler", timeout: 5000 },
  ],
};
```

### 6.3 ServiceOrchestrator 实现

```typescript
/**
 * 服务编排器
 * 
 * 职责：
 * - 按依赖拓扑启动服务
 * - 处理启动失败（部分回滚）
 * - 健康检查
 * - 优雅停机
 */
class ServiceOrchestrator {
  private services: Map<string, ServiceDescriptor> = new Map();
  private instances: Map<string, any> = new Map();
  private startedServices: string[] = [];

  /**
   * 注册服务
   */
  register(descriptor: ServiceDescriptor): void {
    this.services.set(descriptor.name, descriptor);
  }

  /**
   * 按阶段启动所有服务
   */
  async startAll(): Promise<ServiceStartResult> {
    const errors: ServiceError[] = [];

    for (const [phaseName, services] of Object.entries(SERVICE_START_ORDER)) {
      console.log(`[Orchestrator] Starting ${phaseName}...`);

      // 并行启动该阶段服务
      const parallelServices = services.filter((s) => s.parallel);
      const serialServices = services.filter((s) => !s.parallel && !s.background);
      const backgroundServices = services.filter((s) => s.background);

      // 串行服务
      for (const service of serialServices) {
        try {
          await this.startService(service.name, service.timeout);
          this.startedServices.push(service.name);
        } catch (error) {
          errors.push({ name: service.name, error: String(error) });
          // 关键服务失败，停止启动
          if (!service.optional) {
            await this.rollback();
            return { success: false, errors };
          }
        }
      }

      // 并行服务
      if (parallelServices.length > 0) {
        const results = await Promise.allSettled(
          parallelServices.map((s) => 
            this.startService(s.name, s.timeout)
          ),
        );
        
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const service = parallelServices[i];
          
          if (result.status === "fulfilled") {
            this.startedServices.push(service.name);
          } else {
            errors.push({ name: service.name, error: String(result.reason) });
          }
        }
      }

      // 后台服务（不等待）
      for (const service of backgroundServices) {
        this.startService(service.name, service.timeout).catch((error) => {
          console.warn(`[Orchestrator] Background service ${service.name} failed:`, error);
        });
      }
    }

    return {
      success: errors.length === 0,
      startedServices: this.startedServices,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * 优雅停机（逆序）
   */
  async stopAll(): Promise<void> {
    const reversed = [...this.startedServices].reverse();
    
    for (const name of reversed) {
      try {
        const instance = this.instances.get(name);
        if (instance?.stop) {
          await instance.stop();
        }
        console.log(`[Orchestrator] Stopped ${name}`);
      } catch (error) {
        console.error(`[Orchestrator] Failed to stop ${name}:`, error);
      }
    }
    
    this.startedServices = [];
    this.instances.clear();
  }

  /**
   * 回滚已启动的服务
   */
  private async rollback(): Promise<void> {
    console.log("[Orchestrator] Rolling back...");
    await this.stopAll();
  }

  /**
   * 启动单个服务
   */
  private async startService(name: string, timeout: number): Promise<void> {
    const descriptor = this.services.get(name);
    if (!descriptor) {
      throw new Error(`Service ${name} not registered`);
    }

    // 检查依赖
    for (const dep of descriptor.dependencies || []) {
      if (!this.startedServices.includes(dep)) {
        throw new Error(`Dependency ${dep} not started`);
      }
    }

    // 创建实例
    const instance = await descriptor.factory(this.getDependencies(descriptor));
    
    // 启动（带超时）
    if (instance.start) {
      await Promise.race([
        instance.start(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Timeout")), timeout),
        ),
      ]);
    }

    this.instances.set(name, instance);
    console.log(`[Orchestrator] Started ${name}`);
  }

  /**
   * 获取依赖实例
   */
  private getDependencies(descriptor: ServiceDescriptor): Record<string, any> {
    const deps: Record<string, any> = {};
    for (const dep of descriptor.dependencies || []) {
      deps[dep] = this.instances.get(dep);
    }
    return deps;
  }

  /**
   * 获取服务实例
   */
  getService<T>(name: string): T {
    return this.instances.get(name) as T;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {};

    for (const [name, instance] of this.instances) {
      try {
        if (instance.healthCheck) {
          results[name] = await instance.healthCheck();
        } else {
          results[name] = { status: "unknown" };
        }
      } catch (error) {
        results[name] = { status: "error", error: String(error) };
      }
    }

    return results;
  }
}

// ==================== 类型定义 ====================

interface ServiceDescriptor {
  name: string;
  dependencies?: string[];
  optional?: boolean;
  factory: (deps: Record<string, any>) => Promise<any>;
}

interface ServiceStartResult {
  success: boolean;
  startedServices?: string[];
  errors?: ServiceError[];
}

interface ServiceError {
  name: string;
  error: string;
}

interface HealthStatus {
  status: "ok" | "error" | "unknown" | "degraded";
  error?: string;
  details?: Record<string, any>;
}
```

---

## 七、错误处理与重试机制

### 7.1 分层错误处理

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         错误处理分层架构                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Layer 1: UI 层                                                         │
│  ├── 错误提示（Toast / Modal）                                          │
│  └── 用户重试按钮                                                       │
│                                                                         │
│  Layer 2: IPC 层                                                        │
│  ├── 错误序列化（Error → IPC 错误对象）                                  │
│  └── 错误分类（网络错误 / 业务错误 / 系统错误）                           │
│                                                                         │
│  Layer 3: Service 层                                                    │
│  ├── 重试机制（指数退避）                                                │
│  ├── 降级策略（fallback）                                               │
│  └── 错误上报（日志 / 监控）                                            │
│                                                                         │
│  Layer 4: API 层                                                        │
│  ├── 请求重试（网络错误）                                                │
│  ├── Token 刷新（认证错误）                                             │
│  └── 超时控制                                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 重试策略

```typescript
/**
 * 统一重试策略
 */
interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];  // 可重试的错误类型
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "503",
    "502",
    "504",
  ],
};

/**
 * 带重试的执行器
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<T> {
  let lastError: Error | null = null;
  let delay = policy.initialDelayMs;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // 检查是否可重试
      const isRetryable = policy.retryableErrors.some(
        (e) => error.code === e || error.message?.includes(e),
      );

      if (!isRetryable || attempt === policy.maxRetries) {
        throw error;
      }

      policy.onRetry?.(attempt + 1, error);

      // 指数退避
      await sleep(delay);
      delay = Math.min(delay * policy.backoffMultiplier, policy.maxDelayMs);
    }
  }

  throw lastError;
}
```

### 7.3 降级策略

```typescript
/**
 * 降级策略配置
 */
interface FallbackStrategy {
  // 服务器不可用时
  onServerUnavailable: "cache" | "offline" | "error";

  // 模型不可用时
  onModelUnavailable: "fallback-model" | "error";

  // MCP 启动失败时
  onMcpFailed: "continue-without" | "block";

  // Channel 连接失败时
  onChannelFailed: "skip-channel" | "error";
}

const DEFAULT_FALLBACK: FallbackStrategy = {
  onServerUnavailable: "cache",       // 使用本地缓存
  onModelUnavailable: "fallback-model", // 使用备用模型
  onMcpFailed: "continue-without",    // 跳过失败的 MCP，继续运行
  onChannelFailed: "skip-channel",    // 跳过失败的 Channel
};
```

---

## 八、安全性设计

### 8.1 凭据加密存储

```typescript
/**
 * 凭据加密配置
 */
interface CredentialEncryption {
  // 加密算法
  algorithm: "aes-256-gcm";

  // 密钥派生
  keyDerivation: {
    method: "pbkdf2" | "argon2";
    iterations: number;
    saltLength: number;
  };

  // 存储
  storage: {
    location: "keytar" | "encrypted-file" | "os-keychain";
    fallbackToMemory: boolean;  // keytar 不可用时是否降级到内存
  };
}

const DEFAULT_ENCRYPTION: CredentialEncryption = {
  algorithm: "aes-256-gcm",
  keyDerivation: {
    method: "pbkdf2",
    iterations: 100000,
    saltLength: 32,
  },
  storage: {
    location: "keytar",
    fallbackToMemory: true,
  },
};
```

### 8.2 MCP 沙箱

```typescript
/**
 * MCP 执行沙箱配置
 */
interface McpSandboxConfig {
  enabled: boolean;

  // 文件系统限制
  filesystem: {
    allowedPaths: string[];      // 允许访问的路径
    deniedPaths: string[];       // 禁止访问的路径
    readOnlyPaths: string[];     // 只读路径
  };

  // 命令限制
  commands: {
    deniedPatterns: RegExp[];    // 禁止的命令模式
    allowedBinaries: string[];   // 允许的可执行文件
  };

  // 网络限制
  network: {
    enabled: boolean;
    whitelist: string[];         // 允许的域名/IP
    blacklist: string[];         // 禁止的域名/IP
  };

  // 资源限制
  resources: {
    maxMemoryMB: number;
    maxCpuPercent: number;
    timeout: number;
  };
}

const DEFAULT_SANDBOX: McpSandboxConfig = {
  enabled: true,
  filesystem: {
    allowedPaths: ["~/.nuwaclaw/workspace"],
    deniedPaths: ["~/.ssh", "~/.gnupg", "~/.nuwaclaw/config"],
    readOnlyPaths: [],
  },
  commands: {
    deniedPatterns: [/rm\s+-rf/, /sudo/, /chmod/],
    allowedBinaries: ["node", "npx", "uv", "uvx", "python3", "git"],
  },
  network: {
    enabled: true,
    whitelist: [],
    blacklist: [],
  },
  resources: {
    maxMemoryMB: 512,
    maxCpuPercent: 50,
    timeout: 30000,
  },
};
```

### 8.3 传输安全

```typescript
/**
 * 传输安全配置
 */
interface TransportSecurity {
  // HTTPS 强制
  enforceHttps: boolean;

  // 证书锁定（可选）
  certificatePinning?: {
    enabled: boolean;
    publicKeys: string[];  // 服务器公钥指纹
  };

  // 请求签名
  requestSigning?: {
    enabled: boolean;
    algorithm: "hmac-sha256";
  };

  // Token 管理
  tokenManagement: {
    autoRefresh: boolean;
    refreshThresholdMs: number;  // 提前刷新阈值
    secureStorage: boolean;
  };
}

const DEFAULT_TRANSPORT_SECURITY: TransportSecurity = {
  enforceHttps: true,
  tokenManagement: {
    autoRefresh: true,
    refreshThresholdMs: 5 * 60 * 1000,  // 5 分钟前刷新
    secureStorage: true,
  },
};
```

---

## 九、数据目录结构 V2

```
~/.nuwaclaw/
├── config/
│   ├── server.json             # Nuwax 服务端点配置（URL + Auth）
│   ├── providers.json          # 本地 Provider 配置（加密凭据）
│   ├── channels.json           # Channel 配置
│   └── settings.json           # 通用设置
│
├── data/
│   ├── nuwaclaw.db             # SQLite 主数据库
│   │   ├── sessions 表         # 会话（本地缓存 + 服务器同步）
│   │   ├── messages 表         # 消息
│   │   ├── skills 表           # 技能注册（与服务器同步）
│   │   ├── mcp_servers 表      # MCP 配置
│   │   ├── knowledge_cache 表  # 知识库文档本地缓存
│   │   └── sync_queue 表       # 待同步队列
│   └── memory.db               # 向量数据库（sqlite-vec）
│
├── soul/                       # Agent 灵魂（Markdown）
├── memory/                     # 记忆（Markdown + 索引）
├── skills/                     # 技能文件
├── evo-map/                    # 进化图谱
│
└── mcp-servers/                # 本地 MCP 服务器工作目录
```

---

## 十、实施路线

```
Phase 1 (P0)  ─ 服务器连接 + 模型配置同步
                 → NuwaxApiClient + NuwaxSyncService + ModelGateway 双向同步
Phase 2 (P0)  ─ Skills & MCP & Plugin & Workflow 同步
                 → ToolRegistry + 服务器技能/MCP/插件/工作流 同步
Phase 2.5(P0) ─ Knowledge/RAG 同步
                 → KnowledgeSyncAdapter + 本地 RAG 查询缓存
Phase 3 (P0)  ─ 会话管理同步
                 → ChatEngine + 服务器会话双向同步
Phase 4 (P1)  ─ Channel 多渠道接入
                 → IM 消息路由到服务器 Agent 或本地引擎
Phase 5 (P1)  ─ Agent 自我进化落地
                 → Memory/EvoMap/Soul 实际运行
```

---

## 相关文档

- [Nuwax 产品官网](https://nuwax.com/) — 女娲智能体 OS 产品介绍
- [V1 架构总览](../architecture/OVERVIEW.md)
- [V1 隔离策略](../architecture/ISOLATION.md)
- [V1 核心组件](../architecture/COMPONENTS.md)
