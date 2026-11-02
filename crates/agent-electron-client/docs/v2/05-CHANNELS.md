---
version: 2.0
last-updated: 2026-03-09
status: design
---

# 05 — Channel 多渠道接入

## 一、现状分析

### V1 现有实现

`IMService` (`renderer/services/integrations/im.ts`)：

- 纯前端实现，支持 Discord / Telegram / DingTalk / Feishu
- 配置存储在内存中（`loadConfigs` / `saveConfigs` → 未完整实现）
- 各平台实现均为框架代码（TODO 占位）
- 无框架化的消息路由和 Agent 调度

**问题**：

1. 在 Renderer 进程中处理 IM 连接，窗口关闭后不可用
2. 各平台实现高度重复，无统一抽象
3. 收到 IM 消息后无法自动调度 Agent 处理
4. 无消息队列和重试机制

---

## 二、ChannelGateway 设计

### 2.1 核心思路

> **关键特色**：NuwaClaw 配置的域名（如 `https://testagent.xspaceagi.com`）本身已是一个完整的 Agent 服务。Channel 网关的核心职责是将各 IM 平台的消息**转发到该 Agent 服务**，并将 Agent 的响应**回推到 IM 平台**。

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  飞书     │    │  钉钉    │    │ Telegram │    │ Discord  │
│  Bot     │    │  Bot     │    │  Bot     │    │  Bot     │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │               │
     └───────────────┼───────────────┼───────────────┘
                     ▼
┌─────────────────────────────────────────────────────────┐
│              ChannelGateway (Main Process)                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │        ChannelRouter (消息路由)                     │   │
│  │  IM 消息  ──→  匹配目标 Agent Service  ──→ 转发    │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│         ┌────────────────┼─────────────────┐            │
│         ▼                ▼                 ▼            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Agent Service│ │ Local Chat   │ │ Agent Service│   │
│  │ (Remote URL) │ │ Engine       │ │ (另一个域名) │   │
│  │ testagent.   │ │ (本地推理)   │ │ prodagent.   │   │
│  │ xspaceagi.com│ │              │ │ xspaceagi.com│   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│                          │                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │        ResponseRelay (响应回推)                     │   │
│  │  Agent 响应  ──→  格式化  ──→  推送到 IM 平台       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │        MessageQueue (消息队列)                      │   │
│  │  重试  ·  去重  ·  限流  ·  持久化                  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 2.2 两种消息路由模式

| 模式             | 描述                               | 使用场景                                            |
| ---------------- | ---------------------------------- | --------------------------------------------------- |
| **Remote Agent** | 消息转发到配置的 Agent Service URL | 已有完整 Agent 服务（如 `testagent.xspaceagi.com`） |
| **Local Agent**  | 消息路由到本地 `ChatEngine`        | 使用本地模型/Provider 直接处理                      |

```typescript
type ChannelRouteTarget =
  | {
      type: "remote-agent";
      /** 完整的 Agent 服务 URL，本身已是一个工作的 Agent 后端 */
      serviceUrl: string; // e.g. https://testagent.xspaceagi.com
      /** 鉴权方式 */
      auth?: {
        type: "bearer" | "api-key" | "custom-header";
        token: string;
        headerName?: string; // custom-header 时使用
      };
      /** Chat 端点路径（默认 /computer/chat） */
      chatEndpoint?: string;
      /** SSE 端点路径（默认 /computer/progress/{session_id}） */
      progressEndpoint?: string;
    }
  | {
      type: "local-agent";
      /** 本地 Provider + Model */
      providerId: string;
      modelId: string;
      /** 可选系统提示 */
      systemPrompt?: string;
    };
```

---

## 三、Channel 抽象

### 3.1 统一 Channel 接口

```typescript
/** Channel 适配器接口 */
interface ChannelAdapter {
  /** 平台标识 */
  readonly platform: ChannelPlatform;

  /** 初始化连接 */
  connect(config: ChannelConfig): Promise<void>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 连接状态 */
  isConnected(): boolean;

  /** 发送消息到 IM 平台 */
  sendMessage(
    target: MessageTarget,
    content: ChannelMessageContent,
  ): Promise<SendResult>;

  /** 注册消息回调 */
  onMessage(handler: (message: IncomingChannelMessage) => void): void;

  /** 注册事件回调（连接/断开/错误） */
  onEvent(handler: (event: ChannelEvent) => void): void;
}

type ChannelPlatform =
  | "feishu"
  | "dingtalk"
  | "telegram"
  | "discord"
  | "wechat-work"
  | "slack";

interface ChannelConfig {
  id: string; // Channel 实例 ID
  platform: ChannelPlatform;
  enabled: boolean;
  name: string; // 显示名称

  /** 平台凭据 */
  credentials: ChannelCredentials;

  /** 消息路由目标 */
  routeTarget: ChannelRouteTarget;

  /** 行为配置 */
  behavior: {
    autoReply: boolean; // 是否自动回复
    allowedUsers?: string[]; // 用户白名单（空=全部）
    allowedGroups?: string[]; // 群组白名单
    triggerKeyword?: string; // 触发关键词（如 @bot）
    replyFormat: "text" | "markdown" | "card"; // 回复格式
    maxConcurrent: number; // 最大并发会话
  };
}

type ChannelCredentials =
  | { platform: "feishu"; appId: string; appSecret: string }
  | {
      platform: "dingtalk";
      appKey: string;
      appSecret: string;
      robotCode?: string;
    }
  | { platform: "telegram"; botToken: string }
  | { platform: "discord"; botToken: string; applicationId: string }
  | { platform: "wechat-work"; corpId: string; agentId: string; secret: string }
  | { platform: "slack"; botToken: string; appToken: string };
```

### 3.2 消息模型

```typescript
/** 收到的 IM 消息 */
interface IncomingChannelMessage {
  id: string; // 消息 ID
  platform: ChannelPlatform;
  channelConfigId: string; // Channel 配置 ID

  sender: {
    id: string;
    name: string;
    avatar?: string;
  };

  /** 消息来源 */
  source: {
    type: "direct" | "group";
    groupId?: string;
    groupName?: string;
    channelId?: string; // Discord/Slack channel
  };

  /** 消息内容 */
  content: {
    text: string;
    mentions?: string[];
    attachments?: { type: string; url: string; name: string }[];
  };

  /** 是否 @了机器人 */
  mentionedBot: boolean;

  timestamp: number;
  replyToMessageId?: string;
}

/** 回复内容（平台无关） */
interface ChannelMessageContent {
  text: string;
  markdown?: string; // 如果平台支持
  card?: ChannelCardMessage; // 如果平台支持卡片
  attachments?: { name: string; data: Buffer; mimeType: string }[];
}

/** 卡片消息（飞书/钉钉） */
interface ChannelCardMessage {
  title: string;
  sections: {
    type: "text" | "code" | "divider" | "action";
    content?: string;
    language?: string;
    buttons?: { text: string; url?: string; value?: string }[];
  }[];
}
```

---

## 四、ChannelGateway 服务

```typescript
class ChannelGateway {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private configs: Map<string, ChannelConfig> = new Map();
  private sessionMap: Map<string, string> = new Map(); // IM会话 → Agent会话

  // ==================== 配置管理 ====================

  /** 添加/更新 Channel 配置 */
  upsertChannel(config: ChannelConfig): Promise<void>;

  /** 删除 Channel */
  deleteChannel(id: string): Promise<void>;

  /** 列出所有 Channel */
  listChannels(): ChannelConfig[];

  // ==================== 连接管理 ====================

  /** 连接指定 Channel */
  connect(channelId: string): Promise<{ success: boolean; error?: string }>;

  /** 断开指定 Channel */
  disconnect(channelId: string): Promise<void>;

  /** 连接所有启用的 Channel */
  connectAll(): Promise<void>;

  /** 获取连接状态 */
  getStatus(): ChannelStatus[];

  // ==================== 消息处理 ====================

  /** 处理收到的 IM 消息 */
  private handleIncomingMessage(message: IncomingChannelMessage): Promise<void>;

  /**
   * 路由到 Remote Agent Service
   * → POST {serviceUrl}/computer/chat
   * → 监听 SSE {serviceUrl}/computer/progress/{session_id}
   * → 将 Agent 响应格式化后回推到 IM
   */
  private routeToRemoteAgent(
    message: IncomingChannelMessage,
    target: RemoteAgentTarget,
  ): Promise<void>;

  /**
   * 路由到 Local ChatEngine
   * → chatEngine.chat(sessionId, input)
   * → 将响应格式化后回推到 IM
   */
  private routeToLocalAgent(
    message: IncomingChannelMessage,
    target: LocalAgentTarget,
  ): Promise<void>;
}
```

### 4.1 Remote Agent 调用流程

```
                IM 消息到达
                    │
                    ▼
        ┌─── ChannelGateway ─────────────────────────────┐
        │                                                  │
        │  1. 查找/创建 Agent 会话映射                      │
        │     IM(userId+groupId) → agentSessionId          │
        │                                                  │
        │  2. POST {serviceUrl}/computer/chat               │
        │     {                                            │
        │       user_id: sender.id,                        │
        │       project_id: channelConfigId,               │
        │       message: content.text,                     │
        │       session_id: agentSessionId                 │
        │     }                                            │
        │                                                  │
        │  3. 建立 SSE 连接                                 │
        │     GET {serviceUrl}/computer/progress/{sid}      │
        │                                                  │
        │  4. 监听 SSE 事件，组装回复                        │
        │     - text_delta → 累积文本                       │
        │     - tool_call → 可选展示工具调用                │
        │     - stream_end → 发送最终回复到 IM              │
        │                                                  │
        │  5. 格式化回复                                    │
        │     - 纯文本 / Markdown / 卡片消息                │
        │     - 按平台能力适配                              │
        └──────────────────────────────────────────────────┘
```

---

## 五、各平台适配器

### 5.1 飞书 (Feishu / Lark)

```typescript
class FeishuAdapter implements ChannelAdapter {
  readonly platform = "feishu";
  private eventServer: http.Server; // 事件订阅 HTTP 回调
  private accessToken: string;

  async connect(config: ChannelConfig): Promise<void> {
    const cred = config.credentials as FeishuCredentials;

    // 1. 获取 tenant_access_token
    this.accessToken = await this.getTenantAccessToken(
      cred.appId,
      cred.appSecret,
    );

    // 2. 启动事件订阅 HTTP Server（接收飞书推送）
    this.eventServer = http.createServer(this.handleEvent.bind(this));
    // 动态分配端口，避免与本地其他服务冲突
    const port =
      config.callbackPort || (await this.findAvailablePort(9990, 9999));
    this.eventServer.listen(port);

    // 或使用 WebSocket 长连接模式
  }

  async sendMessage(
    target: MessageTarget,
    content: ChannelMessageContent,
  ): Promise<SendResult> {
    // POST https://open.feishu.cn/open-apis/im/v1/messages
    // 支持 text / interactive card / markdown
  }
}
```

### 5.2 钉钉 (DingTalk)

```typescript
class DingtalkAdapter implements ChannelAdapter {
  readonly platform = "dingtalk";

  async connect(config: ChannelConfig): Promise<void> {
    const cred = config.credentials as DingtalkCredentials;
    // Stream 模式（推荐）：SDK 长连接
    // 或 HTTP 回调模式
  }

  async sendMessage(
    target: MessageTarget,
    content: ChannelMessageContent,
  ): Promise<SendResult> {
    // POST https://oapi.dingtalk.com/robot/send
    // 支持 text / markdown / actionCard
  }
}
```

### 5.3 Telegram

```typescript
class TelegramAdapter implements ChannelAdapter {
  readonly platform = "telegram";

  async connect(config: ChannelConfig): Promise<void> {
    const cred = config.credentials as TelegramCredentials;
    // Long Polling 模式（无需公网 IP）
    // getUpdates loop
  }

  async sendMessage(
    target: MessageTarget,
    content: ChannelMessageContent,
  ): Promise<SendResult> {
    // POST https://api.telegram.org/bot{token}/sendMessage
    // 支持 text / markdown / HTML
  }
}
```

### 5.4 工厂模式

```typescript
class ChannelAdapterFactory {
  static create(platform: ChannelPlatform): ChannelAdapter {
    switch (platform) {
      case "feishu":
        return new FeishuAdapter();
      case "dingtalk":
        return new DingtalkAdapter();
      case "telegram":
        return new TelegramAdapter();
      case "discord":
        return new DiscordAdapter();
      case "slack":
        return new SlackAdapter();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
```

---

## 六、IPC 接口设计

```typescript
// Channel CRUD
'channel:list'           → ChannelConfig[]
'channel:get'            → ChannelConfig
'channel:upsert'         → { success: boolean }
'channel:delete'         → { success: boolean }

// 连接控制
'channel:connect'        → { success: boolean; error?: string }
'channel:disconnect'     → { success: boolean }
'channel:connectAll'     → { success: boolean }
'channel:status'         → ChannelStatus[]

// 消息日志
'channel:messages'       → IncomingChannelMessage[]  // 最近的 IM 消息日志

// Events (Main → Renderer)
'channel:event'          Event: { type: 'connected' | 'disconnected' | 'message' | 'error'; ... }
```

---

## 七、UI 设计要点

```
┌─ Channel 管理 ──────────────────────────────────────────┐
│                                                          │
│  ● 飞书 Bot      ✓ 在线   │ 收到 156 条 │ 回复 148 条  │
│  ● 钉钉 Bot      ✓ 在线   │ 收到  89 条 │ 回复  89 条  │
│  ○ Telegram      ✗ 未配置 │                             │
│                                                          │
│  [+ 新增 Channel]   [全部连接]   [全部断开]              │
│                                                          │
│  ── 飞书 Bot 配置 ──────────────────────                 │
│  App ID:       [cli_xxxxx          ]                     │
│  App Secret:   [••••••••••••••••   ]                     │
│                                                          │
│  消息路由:  ● 远程 Agent 服务                             │
│            URL: [https://testagent.xspaceagi.com  ]      │
│            认证: [Bearer Token ▾]  [••••••••••]          │
│            ○ 本地 Agent                                  │
│            Provider: [OpenAI ▾]   Model: [gpt-4o ▾]     │
│                                                          │
│  行为:                                                   │
│  ☑ 自动回复     触发词: [@NuwaClaw ]                     │
│  ☑ 群聊回复     回复格式: [卡片消息 ▾]                    │
│  最大并发: [5]                                           │
│                                                          │
│                      [测试连接]  [保存]                   │
└──────────────────────────────────────────────────────────┘
```

---

## 相关文档

- [总体架构](./01-ARCHITECTURE.md)
- [会话管理](./04-SESSION-CHAT.md) — Channel 消息创建的会话
- [V1 IMService](../../src/renderer/services/integrations/im.ts)
