---
version: 2.0
last-updated: 2026-03-09
status: design
---

# 02 — 模型配置与多 Provider 管理

## 一、现状分析

### V1 现有实现

当前通过 `EngineManager` + `AgentConfig` 支持两种引擎（`claude-code` / `nuwaxcode`），
配置项散落在 `EngineStartConfig`、`AgentInitConfig`、`settings` DB 表中。

### Nuwax 服务端已有能力

服务器已有完整的模型管理 API（`workspace/nuwax/src/services/modelConfig.ts`）：

| 端点                                   | 能力               |
| -------------------------------------- | ------------------ |
| `POST /api/model/save`                 | 新增/更新模型配置  |
| `POST /api/model/list`                 | 查询可用模型列表   |
| `POST /api/model/test-connectivity`    | 测试模型连通性     |
| `GET  /api/model/{id}`                 | 查询指定模型配置   |
| `GET  /api/model/{id}/delete`          | 删除模型配置       |
| `GET  /api/model/list/space/{spaceId}` | 查询空间下模型列表 |

**目标**：客户端的模型配置与服务器**双向同步**，服务器为权威来源。

---

## 二、设计方案

### 2.1 Provider 抽象

```typescript
/** 模型提供商 */
interface ModelProvider {
  id: string; // 'openai' | 'anthropic' | 'google' | 'local' | 自定义
  name: string; // 显示名称
  type: ProviderType; // 'openai-compat' | 'anthropic' | 'acp-engine' | 'ollama'
  enabled: boolean;
  isDefault: boolean;

  /** 服务器同步信息 */
  serverId?: number; // 服务器端模型配置 ID（来自 /api/model/save）
  syncedAt?: number; // 上次同步时间
  syncSource: "local" | "server"; // 来源（本地创建 or 服务器拉取）

  connection: {
    baseUrl: string; // API 端点
    apiKey?: string; // 会被加密存储
    timeout?: number;
    maxRetries?: number;
    headers?: Record<string, string>;
  };

  models: ModelEntry[];
  capabilities: ProviderCapability[];
}

type ProviderType =
  | "openai-compat" // OpenAI 兼容 API (GPT, DeepSeek, Qwen, GLM, Moonshot 等)
  | "anthropic" // Claude API
  | "acp-engine" // ACP 协议引擎（现有 claude-code / nuwaxcode）
  | "ollama" // 本地 Ollama
  | "custom";

type ProviderCapability =
  | "chat"
  | "streaming"
  | "function-calling"
  | "vision"
  | "code-execution"
  | "file-access"
  | "embedding"; // 文本嵌入向量化

/** 模型条目 */
interface ModelEntry {
  id: string; // 'gpt-4o' | 'claude-sonnet-4-20250514'
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: { inputPer1k: number; outputPer1k: number; currency: string };
  isDefault?: boolean;
}
```

### 2.2 Provider 预设

系统内置常见 Provider 预设，用户只需填入 API Key：

```typescript
const BUILT_IN_PRESETS: Partial<ModelProvider>[] = [
  {
    id: "openai",
    name: "OpenAI",
    type: "openai-compat",
    connection: { baseUrl: "https://api.openai.com/v1" },
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "o3-mini", name: "o3 Mini" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    connection: { baseUrl: "https://api.anthropic.com" },
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai-compat",
    connection: { baseUrl: "https://api.deepseek.com/v1" },
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek R1" },
    ],
  },
  {
    id: "qwen",
    name: "通义千问 (Qwen)",
    type: "openai-compat",
    connection: {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    models: [
      { id: "qwen-max", name: "Qwen Max" },
      { id: "qwen-plus", name: "Qwen Plus" },
      { id: "qwen3:32b", name: "Qwen3 32B" },
    ],
  },
  {
    id: "glm",
    name: "智谱 (GLM)",
    type: "openai-compat",
    connection: { baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    models: [
      { id: "glm-4", name: "GLM-4" },
      { id: "glm-4-flash", name: "GLM-4 Flash" },
      { id: "glm-4.7-anthropic", name: "GLM-4.7 Anthropic" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    type: "ollama",
    connection: { baseUrl: "http://localhost:11434" },
    models: [], // 运行时从 Ollama API 动态获取
    capabilities: ["chat", "streaming", "embedding"],
  },
  {
    id: "acp-claude",
    name: "Claude Code (ACP)",
    type: "acp-engine",
    capabilities: ["chat", "streaming", "code-execution", "file-access"],
  },
  {
    id: "acp-nuwaxcode",
    name: "NuwaxCode (ACP)",
    type: "acp-engine",
    capabilities: ["chat", "streaming", "code-execution", "file-access"],
  },
];

// Embedding 模型预设（服务器已有 text-embedding 模型，用于知识库/记忆向量化）
const EMBEDDING_PRESETS: Partial<ModelProvider>[] = [
  {
    id: "openai-embedding",
    name: "OpenAI Embedding",
    type: "openai-compat",
    connection: { baseUrl: "https://api.openai.com/v1" },
    models: [
      { id: "text-embedding-3-small", name: "Embedding 3 Small" },
      { id: "text-embedding-3-large", name: "Embedding 3 Large" },
    ],
    capabilities: ["embedding"],
  },
];
```

### 2.3 凭据安全存储

使用 Electron 内置的 `safeStorage` API 加密凭据：

```typescript
import { safeStorage } from "electron";

class ElectronCredentialStore implements CredentialStore {
  async set(providerId: string, key: string, value: string): Promise<void> {
    const encrypted = safeStorage.encryptString(value);
    db.prepare(
      "INSERT OR REPLACE INTO credentials (provider_id, key, value) VALUES (?, ?, ?)",
    ).run(providerId, key, encrypted);
  }

  async get(providerId: string, key: string): Promise<string | null> {
    const row = db
      .prepare(
        "SELECT value FROM credentials WHERE provider_id = ? AND key = ?",
      )
      .get(providerId, key) as { value: Buffer } | undefined;
    if (!row) return null;
    return safeStorage.decryptString(row.value);
  }
}
```

---

## 三、与服务器同步

### 3.1 同步流程

```
┌─────────────┐                        ┌──────────────────┐
│  NuwaClaw   │                        │  Nuwax Agent OS  │
│  Desktop    │                        │  (用户部署)       │
└──────┬──────┘                        └──────┬───────────┘
       │                                      │
       │  ──── 启动 / 定时 / 手动触发同步 ────    │
       │                                      │
       │  POST /api/model/list                 │
       │  { spaceId }                          │
       │ ────────────────────────────────────→ │
       │                                      │
       │  ← ModelConfigInfo[]                  │
       │ ←──────────────────────────────────── │
       │                                      │
       │  合并本地 Provider                    │
       │  • 服务器有/本地无 → 拉取创建         │
       │  • 服务器有/本地有 → 以服务器为准      │
       │  • 仅本地有 → 保留或推送到服务器      │
       │                                      │
       │  POST /api/model/save  (推送本地新增)  │
       │ ────────────────────────────────────→ │
       │                                      │
```

### 3.2 ModelSyncAdapter

```typescript
class ModelSyncAdapter {
  constructor(
    private nuwaxClient: NuwaxApiClient,
    private modelGateway: ModelGateway,
    private credentialStore: CredentialStore,
  ) {}

  /** 从服务器拉取并合并模型配置 */
  async pull(): Promise<SyncResult> {
    const spaceId = this.nuwaxClient.getSpaceId();
    const serverModels = await this.nuwaxClient.request<ModelConfigInfo[]>(
      "POST",
      `/api/model/list`,
      { spaceId },
    );

    let pulled = 0;
    for (const sm of serverModels) {
      const localProvider = this.modelGateway.findByServerId(sm.id);

      if (!localProvider) {
        // 服务器有，本地无 → 创建本地 Provider
        await this.modelGateway.upsertProvider(this.mapServerToLocal(sm));
        pulled++;
      } else if (sm.updatedAt > localProvider.syncedAt!) {
        // 服务器更新 → 以服务器为准
        await this.modelGateway.upsertProvider({
          ...localProvider,
          ...this.mapServerToLocal(sm),
        });
        pulled++;
      }
    }

    return { success: true, pulled, pushed: 0, conflicts: [] };
  }

  /** 推送本地新增/修改到服务器 */
  async push(): Promise<SyncResult> {
    const localOnly = this.modelGateway
      .listProviders()
      .filter((p) => p.syncSource === "local" && !p.serverId);

    let pushed = 0;
    for (const lp of localOnly) {
      const apiKey = await this.credentialStore.get(lp.id, "apiKey");
      await this.nuwaxClient.request("POST", "/api/model/save", {
        baseUrl: lp.connection.baseUrl,
        apiKey,
        modelId: lp.models[0]?.id,
        name: lp.name,
        // ... 映射到 ModelSaveParams
      });
      pushed++;
    }

    return { success: true, pulled: 0, pushed, conflicts: [] };
  }

  /** 测试连通性（可以走服务器或本地直连） */
  async testConnection(providerId: string): Promise<{ success: boolean }> {
    const provider = this.modelGateway.getProvider(providerId);

    if (provider.serverId) {
      // 通过服务器测试
      return this.nuwaxClient.request("POST", "/api/model/test-connectivity", {
        modelId: provider.serverId,
      });
    } else {
      // 本地直连测试
      return this.modelGateway.testConnection(providerId);
    }
  }
}
```

---

## 四、ModelGateway 服务

```typescript
class ModelGateway {
  private providers: Map<string, ModelProvider> = new Map();
  private credentialStore: CredentialStore;
  private syncAdapter: ModelSyncAdapter;

  /** 获取所有已配置 Provider */
  listProviders(): ModelProvider[];

  /** 添加/更新 Provider */
  upsertProvider(provider: ModelProvider): Promise<void>;

  /** 删除 Provider */
  deleteProvider(id: string): Promise<void>;

  /** 获取默认 Provider + Model */
  getDefault(): { provider: ModelProvider; model: ModelEntry } | null;

  /** 测试连接 */
  testConnection(providerId: string): Promise<{
    success: boolean;
    latencyMs?: number;
    models?: ModelEntry[];
    error?: string;
  }>;

  /** 动态获取模型列表 */
  fetchModels(providerId: string): Promise<ModelEntry[]>;

  /** 创建 Chat 客户端（返回统一接口） */
  createChatClient(providerId: string, modelId: string): ChatClient;

  /** 与服务器同步 */
  syncWithServer(): Promise<SyncResult>;
}
```

### ChatClient 统一接口

```typescript
interface ChatClient {
  chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<ChatChunk>;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  abort(): void;
}

interface ChatChunk {
  type: "text" | "tool_call" | "tool_result" | "reasoning" | "done" | "error";
  text?: string;
  toolCall?: { id: string; name: string; arguments: string };
  usage?: { inputTokens: number; outputTokens: number };
}
```

---

## 五、IPC 接口设计

```typescript
// Provider CRUD
'provider:list'        → ModelProvider[]
'provider:get'         → ModelProvider
'provider:upsert'      → { success: boolean }
'provider:delete'      → { success: boolean }
'provider:test'        → { success: boolean; latencyMs?: number; error?: string }
'provider:fetchModels' → ModelEntry[]
'provider:setDefault'  → { success: boolean }
'provider:getDefault'  → { provider: ModelProvider; model: ModelEntry } | null

// 同步
'provider:sync'        → SyncResult
'provider:syncStatus'  → SyncStatus
```

---

## 六、UI 设计要点

### Provider 设置页

```
┌─ 模型配置 ──────────────────────────────────────────────┐
│                                                          │
│  服务器: https://testagent.xspaceagi.com  [✓ 已连接]     │
│  上次同步: 2 分钟前  [立即同步]                           │
│                                                          │
│  ┌─────────────────────────────────┐  ┌──── 添加 ──┐   │
│  │ ● OpenAI        ✓ 已连接  [默认] │  │ + 添加 Provider │
│  │ ○ Anthropic     ✓ 已连接  [云端] │  └────────────┘   │
│  │ ○ DeepSeek      ✗ 未配置  [云端] │                    │
│  │ ○ Ollama        ✓ 3 个模型 [本地] │                    │
│  └─────────────────────────────────┘                    │
│                                                          │
│  ── OpenAI 配置 ──────────────────                       │
│  来源:  ☁ 来自服务器 / 🖥 本地新增                        │
│  API Key:     [••••••••••••••••]  [测试连接]             │
│  Base URL:    [https://api.openai.com/v1  ]              │
│  默认模型:    [gpt-4o         ▾]                         │
│                                                          │
│  ── 可用模型 ──────────────────────                      │
│  │ gpt-4o        │ 128K │ $2.50/M │ ★ 默认              │
│  │ gpt-4o-mini   │ 128K │ $0.15/M │                     │
│           [刷新模型列表]                                   │
└──────────────────────────────────────────────────────────┘
```

---

## 七、迁移策略

### 从 V1 迁移

1. 读取 V1 `settings` 表中的 `apiKey`、`baseUrl`、`model`
2. 自动创建对应 Provider 配置
3. 将明文 API Key 迁移到 `safeStorage` 加密存储
4. 删除 `settings` 中的明文凭据
5. 连接到 Nuwax server 后，首次同步拉取服务器模型配置

---

## 相关文档

- [总体架构](./01-ARCHITECTURE.md)
- [会话管理](./04-SESSION-CHAT.md)
- [Nuwax Server modelConfig.ts](file:///Users/apple/workspace/nuwax/src/services/modelConfig.ts)
