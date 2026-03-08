---
version: 2.0
last-updated: 2026-03-09
status: design
---

# 04 — 会话管理与 Chat 流程

## 一、现状分析

### Nuwax 服务端已有能力

会话管理 API（`workspace/nuwax/src/services/agentConfig.ts`）：

| 端点                                        | 能力             |
| ------------------------------------------- | ---------------- |
| `GET /api/agent/conversation/{id}`          | 查询会话         |
| `POST /api/agent/conversation/message/list` | 查询会话消息列表 |
| `POST /api/agent/conversation/chat/stop`    | 停止会话         |
| `POST /api/agent/conversation/create`       | 创建会话         |
| `POST /api/agent/conversation/list`         | 会话列表         |

Chat API（`workspace/nuwax/src/services/appDev.ts`）：

| 端点                                      | 能力         |
| ----------------------------------------- | ------------ |
| `POST /api/computer/chat`                 | 发送聊天消息 |
| `GET  /api/computer/progress/{sessionId}` | SSE 进度流   |
| `POST /api/computer/cancel`               | 取消任务     |

**目标**：客户端会话与服务器**双向同步**，支持跨设备会话连续性。

### V1 现有实现

- **本地数据库**：SQLite 仅有 `settings` 表（key-value 存储，无会话/消息表）
- **会话存储**：会话数据完全由 ACP Engine（子进程）管理，不在 Electron 主数据库中
- **Chat 流程**：
  - 通过 `computerServer.ts` 的 `/computer/chat` HTTP 端点
  - 内部调用 `UnifiedAgentService.chat()` → ACP Engine
  - SSE 推送进度事件给前端
- **ACP SDK 会话**：`UnifiedAgentService` 管理 ACP 层面的 session（create/list/get/delete/fork）

**问题**：

1. 会话依赖 ACP Engine，无法直接对话普通 LLM API
2. 本地无会话/消息持久化（仅 ACP 子进程内部管理）
3. SSE 事件通过 HTTP Server 中转，链路过长
4. 无会话搜索/标签/归档功能

---

## 二、本地会话引擎设计

### 2.1 架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      ChatEngine (会话引擎)                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ SessionMgr   │  │ MessageStore │  │ StreamRelay  │           │
│  │ 会话管理      │  │ 消息持久化    │  │ 流式中继      │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                    │
│  ┌──────▼─────────────────▼─────────────────▼──────────────────┐ │
│  │                  ChatPipeline (对话管道)                       │ │
│  │                                                              │ │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────────┐  │ │
│  │  │ PreProc │→│ Provider  │→│ PostProc │→│ MemoryEncode │  │ │
│  │  │ (预处理) │  │ (调用LLM) │  │ (后处理) │  │ (记忆编码)   │  │ │
│  │  └─────────┘  └──────────┘  └─────────┘  └──────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              调用层 (Routing)                                  │ │
│  │   ModelGateway.createChatClient()                             │ │
│  │   OR UnifiedAgentService (ACP Mode)                           │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 双模式运行

| 模式         | 描述                                | Provider 类型                         |
| ------------ | ----------------------------------- | ------------------------------------- |
| **直接模式** | ChatEngine 直接调用 LLM API         | openai-compat / anthropic / ollama    |
| **ACP 模式** | ChatEngine 委托 UnifiedAgentService | acp-engine（claude-code / nuwaxcode） |

ACP 模式下，ChatEngine 负责会话管理和消息持久化，
实际推理仍然走 ACP SDK → 子进程引擎。

---

## 三、数据模型

### 3.1 会话表 (sessions)

```sql
CREATE TABLE sessions_v2 (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT 'New Chat',
  summary         TEXT,                    -- AI 生成的摘要
  provider_id     TEXT NOT NULL,           -- 使用的 Provider
  model_id        TEXT NOT NULL,           -- 使用的模型
  system_prompt   TEXT,                    -- 系统提示
  mode            TEXT NOT NULL DEFAULT 'direct',  -- 'direct' | 'acp'
  acp_session_id  TEXT,                    -- ACP 模式下的引擎会话 ID

  -- 分类
  tags            TEXT,                    -- JSON 数组
  folder          TEXT,                    -- 文件夹/分组
  is_pinned       INTEGER DEFAULT 0,       -- 是否置顶
  is_archived     INTEGER DEFAULT 0,       -- 是否归档

  -- 统计
  message_count   INTEGER DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  total_cost      REAL DEFAULT 0,          -- 估算费用

  -- Channel 关联
  channel_id      TEXT,                    -- 来源 Channel (如飞书/钉钉)
  channel_meta    TEXT,                    -- Channel 元数据 JSON

  -- 时间
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_message_at INTEGER
);

CREATE INDEX idx_sessions_updated ON sessions_v2(updated_at DESC);
CREATE INDEX idx_sessions_folder ON sessions_v2(folder);
CREATE INDEX idx_sessions_channel ON sessions_v2(channel_id);
```

### 3.2 消息表 (messages)

```sql
CREATE TABLE messages_v2 (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions_v2(id) ON DELETE CASCADE,
  parent_id       TEXT,                    -- 支持消息树（分支对话）

  role            TEXT NOT NULL,           -- 'system' | 'user' | 'assistant' | 'tool'
  content_type    TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'multipart'

  -- 文本内容
  text_content    TEXT,                    -- 纯文本消息

  -- 多部件内容 (multipart)
  parts           TEXT,                    -- JSON: ContentPart[]

  -- Tool Call (assistant 发起)
  tool_calls      TEXT,                    -- JSON: ToolCall[]

  -- Tool Result (tool role)
  tool_call_id    TEXT,                    -- 对应的 tool_call ID
  tool_name       TEXT,                    -- 工具名称

  -- 元数据
  model_id        TEXT,                    -- 实际使用的模型
  usage           TEXT,                    -- JSON: { inputTokens, outputTokens }
  latency_ms      INTEGER,                -- 响应耗时

  -- ACP 特有
  acp_message_id  TEXT,                    -- ACP 消息 ID
  acp_parts       TEXT,                    -- ACP Part[] 原始数据

  -- 状态
  status          TEXT DEFAULT 'completed', -- 'pending' | 'streaming' | 'completed' | 'error' | 'aborted'
  error           TEXT,                    -- 错误信息

  -- 时间
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_messages_session ON messages_v2(session_id, created_at);
CREATE INDEX idx_messages_parent ON messages_v2(parent_id);
```

### 3.3 ContentPart 类型

```typescript
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url?: string; base64?: string; mimeType: string }
  | { type: "file"; uri: string; mimeType?: string }
  | { type: "code"; language: string; code: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string;
      isError?: boolean;
    }
  | { type: "thinking"; text: string } // reasoning / chain-of-thought
  | { type: "step_start"; stepId: string; title?: string }
  | { type: "step_finish"; stepId: string; result?: unknown }
  | { type: "diff"; filePath: string; hunks: unknown[] }; // 代码差异
```

---

## 四、ChatPipeline（对话管道）

### 4.1 管道流程

```
用户消息
    │
    ▼
┌─── PreProcessor ───────────────────────────┐
│  1. 注入 system prompt                      │
│  2. 注入 Soul.md 上下文（自我进化）           │
│  3. 注入 Memory 相关记忆                     │
│  4. 注入 Tools schema（如果模型支持 FC）      │
│  5. 上下文窗口管理（截断/摘要）               │
│  6. Channel 适配（IM 消息格式转换）            │
└────────────────────────────┬────────────────┘
                             ▼
┌─── Provider Call ──────────────────────────┐
│  直接模式:                                  │
│    ChatClient.chatStream(messages)          │
│  ACP 模式:                                  │
│    UnifiedAgentService.chat(session, msg)   │
└────────────────────────────┬────────────────┘
                             ▼
┌─── PostProcessor ──────────────────────────┐
│  1. Tool Call 处理（调用 ToolRegistry）       │
│  2. 权限检查（需要用户确认的操作）            │
│  3. 消息持久化到 messages_v2                 │
│  4. 更新会话统计（token/cost）               │
│  5. Channel 回复（如果来自 IM）              │
└────────────────────────────┬────────────────┘
                             ▼
┌─── MemoryEncoder ──────────────────────────┐
│  1. 判断是否需要编码为记忆                    │
│  2. 提取 task/outcome/context               │
│  3. 异步写入 Memory 系统                     │
└────────────────────────────────────────────┘
```

### 4.2 流式输出

```typescript
interface ChatStreamEvent {
  type: ChatStreamEventType;
  sessionId: string;
  messageId: string;
  timestamp: number;

  // 具体事件数据
  text?: string; // 文本增量
  toolCall?: {
    // Tool Call 开始
    id: string;
    name: string;
    arguments: string;
  };
  toolResult?: {
    // Tool 执行结果
    toolCallId: string;
    output: string;
    isError: boolean;
  };
  thinking?: string; // 推理过程
  usage?: {
    // Token 统计
    inputTokens: number;
    outputTokens: number;
  };
  error?: string; // 错误
}

type ChatStreamEventType =
  | "stream_start"
  | "text_delta"
  | "thinking_delta"
  | "tool_call_start"
  | "tool_call_delta"
  | "tool_result"
  | "usage"
  | "stream_end"
  | "error"
  | "aborted";
```

### 4.3 上下文窗口管理

```typescript
interface ContextWindowManager {
  /** 根据模型上下文窗口大小，智能截断历史消息 */
  truncateHistory(
    messages: ChatMessage[],
    maxTokens: number,
    strategy: TruncationStrategy,
  ): ChatMessage[];
}

type TruncationStrategy =
  | "sliding-window" // 保留最近 N 条
  | "summarize-old" // 对旧消息生成摘要
  | "smart-select"; // 智能选择重要消息
```

---

## 五、ChatEngine 接口

```typescript
class ChatEngine {
  private sessionMgr: SessionManager;
  private messageStore: MessageStore;
  private pipeline: ChatPipeline;
  private modelGateway: ModelGateway;
  private unifiedAgent: UnifiedAgentService;

  // ==================== 会话管理 ====================

  /** 创建新会话 */
  createSession(options: CreateSessionOptions): Promise<SessionV2>;

  /** 获取会话列表（支持搜索/过滤/分页） */
  listSessions(
    filter?: SessionFilter,
  ): Promise<{ sessions: SessionV2[]; total: number }>;

  /** 获取会话详情 */
  getSession(id: string): Promise<SessionV2>;

  /** 更新会话（标题/标签/文件夹等） */
  updateSession(id: string, updates: Partial<SessionV2>): Promise<SessionV2>;

  /** 删除会话 */
  deleteSession(id: string): Promise<void>;

  /** 归档会话 */
  archiveSession(id: string): Promise<void>;

  /** 置顶/取消置顶 */
  pinSession(id: string, pinned: boolean): Promise<void>;

  /** 分支会话（从某条消息开始新分支） */
  forkSession(id: string, messageId: string): Promise<SessionV2>;

  // ==================== 消息管理 ====================

  /** 获取会话消息列表 */
  getMessages(
    sessionId: string,
    options?: MessageQueryOptions,
  ): Promise<MessageV2[]>;

  /** 获取消息树（分支结构） */
  getMessageTree(sessionId: string): Promise<MessageTreeNode[]>;

  // ==================== 对话 ====================

  /** 发送消息并获取流式响应 */
  chat(sessionId: string, message: UserInput): AsyncIterable<ChatStreamEvent>;

  /** 中止当前生成 */
  abort(sessionId: string): Promise<void>;

  /** 重新生成最后一条回复 */
  regenerate(
    sessionId: string,
    options?: RegenerateOptions,
  ): AsyncIterable<ChatStreamEvent>;

  /** 编辑并重新发送用户消息 */
  editAndResend(
    sessionId: string,
    messageId: string,
    newContent: string,
  ): AsyncIterable<ChatStreamEvent>;

  // ==================== 搜索 ====================

  /** 全文搜索消息内容 */
  searchMessages(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]>;
}

interface CreateSessionOptions {
  title?: string;
  providerId?: string; // 默认使用全局默认
  modelId?: string;
  systemPrompt?: string;
  mode?: "direct" | "acp";
  tags?: string[];
  folder?: string;
}

interface SessionFilter {
  search?: string; // 标题/摘要搜索
  folder?: string;
  tags?: string[];
  isArchived?: boolean;
  isPinned?: boolean;
  channelId?: string;
  dateRange?: { from: number; to: number };
  limit?: number;
  offset?: number;
  sortBy?: "updated_at" | "created_at" | "last_message_at";
}

interface UserInput {
  content: string | ContentPart[];
  attachments?: { name: string; data: Buffer; mimeType: string }[];
}

interface RegenerateOptions {
  modelId?: string; // 可以切换模型重新生成
  providerId?: string;
  temperature?: number;
}
```

---

## 六、IPC 接口设计

```typescript
// Session
'chat:session:create'      → SessionV2
'chat:session:list'        → { sessions: SessionV2[]; total: number }
'chat:session:get'         → SessionV2
'chat:session:update'      → SessionV2
'chat:session:delete'      → { success: boolean }
'chat:session:archive'     → { success: boolean }
'chat:session:pin'         → { success: boolean }
'chat:session:fork'        → SessionV2

// Messages
'chat:messages:get'        → MessageV2[]
'chat:messages:tree'       → MessageTreeNode[]
'chat:messages:search'     → SearchResult[]

// Chat
'chat:send'                → { messageId: string }  // 异步启动
'chat:abort'               → { success: boolean }
'chat:regenerate'          → { messageId: string }
'chat:editResend'          → { messageId: string }

// Stream Events (Main → Renderer)
'chat:stream'              Event: ChatStreamEvent
```

### IPC 事件流

```
Renderer                          Main Process
   │                                  │
   │  chat:send(sessionId, input)     │
   │ ────────────────────────────────→│
   │                                  │
   │  ← { messageId }                │  (立即返回)
   │                                  │
   │  chat:stream event              │  (持续推送)
   │ ←────────────────────────────── │
   │  { type: 'text_delta', ... }    │
   │ ←────────────────────────────── │
   │  { type: 'tool_call_start',..} │
   │ ←────────────────────────────── │
   │  { type: 'tool_result', ... }   │
   │ ←────────────────────────────── │
   │  { type: 'text_delta', ... }    │
   │ ←────────────────────────────── │
   │  { type: 'stream_end', ... }    │
   │ ←────────────────────────────── │
```

---

## 七、与 Nuwax 服务器同步

### 7.1 ConversationSyncAdapter

```typescript
class ConversationSyncAdapter {
  constructor(
    private nuwaxClient: NuwaxApiClient,
    private chatEngine: ChatEngine,
  ) {}

  /** 从服务器拉取会话列表 */
  async pullConversations(agentId: number): Promise<SyncResult> {
    const serverConversations = await this.nuwaxClient.request<
      ConversationInfo[]
    >("POST", "/api/agent/conversation/list", { agentId });

    let pulled = 0;
    for (const sc of serverConversations) {
      const exists = await this.chatEngine.getSession(String(sc.id));
      if (!exists || sc.updatedAt > exists.updatedAt) {
        const messages = await this.nuwaxClient.request<MessageInfo[]>(
          "POST",
          "/api/agent/conversation/message/list",
          { conversationId: sc.id },
        );
        await this.chatEngine.importSession(sc, messages);
        pulled++;
      }
    }

    return { success: true, pulled, pushed: 0, conflicts: [] };
  }

  /** 推送本地会话到服务器 */
  async pushConversations(): Promise<SyncResult> {
    const localOnly = await this.chatEngine.getUnsynced();

    let pushed = 0;
    for (const session of localOnly) {
      const messages = await this.chatEngine.getMessages(session.id);
      await this.nuwaxClient.request("POST", "/api/agent/conversation/create", {
        agentId: session.agentId,
        title: session.title,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.text_content,
        })),
      });
      await this.chatEngine.markSynced(session.id);
      pushed++;
    }

    return { success: true, pulled: 0, pushed, conflicts: [] };
  }
}
```

### 7.2 直接转发到服务器

当配置的服务 URL（如 `https://testagent.xspaceagi.com`）可达时，
Chat 可以直接转发到服务器的 `/api/computer/chat` + SSE 端点：

```typescript
async function* chatViaServer(
  serviceUrl: string,
  message: string,
  sessionId: string,
): AsyncIterable<ChatStreamEvent> {
  // 1. POST 到服务器
  await fetch(`${serviceUrl}/api/computer/chat`, {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      prompt: message,
      session_id: sessionId,
    }),
  });

  // 2. 建立 SSE 连接接收进度
  const eventSource = new EventSource(
    `${serviceUrl}/api/computer/progress/${sessionId}`,
  );

  // 3. 转换并 yield 事件
  for await (const event of eventSource) {
    yield mapServerEventToLocal(event);
  }
}
```

### 7.3 服务器侧完整 Conversation API

服务器实际提供的 Conversation API 比基本同步所需更丰富，客户端可按需集成：

| 端点                                            | 能力     | 客户端集成优先级 |
| ----------------------------------------------- | -------- | ---------------- |
| `POST /api/agent/conversation/create`           | 创建会话 | P0               |
| `POST /api/agent/conversation/list`             | 会话列表 | P0               |
| `GET  /api/agent/conversation/{id}`             | 查询会话 | P0               |
| `POST /api/agent/conversation/message/list`     | 消息列表 | P0               |
| `POST /api/agent/conversation/update`           | 更新会话 | P1               |
| `POST /api/agent/conversation/delete/{id}`      | 删除会话 | P1               |
| `POST /api/agent/conversation/chat/stop`        | 停止会话 | P0               |
| `POST /api/agent/conversation/share`            | 分享会话 | P2               |
| `POST /api/agent/conversation/chat/suggest`     | AI 建议  | P2               |
| `POST /api/agent/conversation/chat/page/result` | 分页结果 | P2               |

### 7.4 V1 兼容

保留 `computerServer.ts` 的 `/computer/chat` 端点，内部改为调用 `ChatEngine`。

> ❗ 注意：V1 本地数据库（`db.ts`）仅有 `settings` 表，无 sessions/messages 数据可迁移。
> 历史会话数据需从 ACP SDK 的内部存储导出（通过 `UnifiedAgentService.listSessions()`），
> 或直接从服务器拉取历史会话，不做本地迁移。

---

## 相关文档

- [总体架构](./01-ARCHITECTURE.md)
- [模型配置](./02-MODEL-CONFIG.md)
- [Skills & MCP](./03-SKILLS-MCP.md)
- [Channel 接入](./05-CHANNELS.md)
