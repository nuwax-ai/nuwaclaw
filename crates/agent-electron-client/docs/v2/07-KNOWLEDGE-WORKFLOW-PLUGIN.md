---
version: 2.0
last-updated: 2026-03-09
status: design
---

# 07 — 知识库 · 工作流 · 插件（服务器能力代理）

## 一、设计定位

> **客户端不复制服务器的全部功能，而是提供一体化的使用体验和便捷配置入口。**
>
> 知识库、工作流、插件的核心逻辑（文档解析、节点执行、插件运行）均在**服务器**完成。
> 客户端的职责是：
>
> 1. **便捷配置** — 提供友好的 UI 配置入口，以替代切换到浏览器操作
> 2. **调用代理** — Chat 过程中需要调用知识库/工作流/插件时，代理转发到服务器
> 3. **状态展示** — 展示知识库索引状态、工作流运行状态、插件可用状态

---

## 二、服务器已有能力

### 知识库 API（`workspace/nuwax/src/services/knowledge.ts`）

| 端点                                               | 能力           |
| -------------------------------------------------- | -------------- |
| `POST /api/knowledge/config/add`                   | 创建知识库     |
| `POST /api/knowledge/config/update`                | 更新知识库配置 |
| `POST /api/knowledge/config/list`                  | 知识库列表     |
| `GET  /api/knowledge/config/{id}`                  | 知识库详情     |
| `POST /api/knowledge/document/add`                 | 上传文档       |
| `POST /api/knowledge/document/list`                | 文档列表       |
| `GET  /api/knowledge/document/{id}`                | 文档详情       |
| `POST /api/knowledge/document/generate-qa`         | 生成 Q&A       |
| `POST /api/knowledge/document/generate-embeddings` | 生成嵌入向量   |
| `POST /api/knowledge/raw-segment/list`             | 分段列表       |
| `POST /api/knowledge/raw-segment/add`              | 添加分段       |
| `POST /api/knowledge/qa/update`                    | 更新问答       |

Agent 组件绑定：`POST /api/agent/component/knowledge/update`

### 工作流 API（`workspace/nuwax/src/services/workflow.ts`）

| 端点                                | 能力           |
| ----------------------------------- | -------------- |
| `GET  /api/workflow/{id}`           | 获取工作流详情 |
| `POST /api/workflow/update`         | 更新工作流信息 |
| `POST /api/workflow/publish`        | 发布工作流     |
| `POST /api/workflow/test-run`       | 工作流试运行   |
| `GET  /api/workflow/node/list/{id}` | 获取节点列表   |
| `POST /api/workflow/node/add`       | 新增节点       |
| `POST /api/workflow/node/execute`   | 单节点试运行   |

Agent 组件绑定：`POST /api/agent/component/workflow/update`

### 插件 API（`workspace/nuwax/src/services/plugin.ts`）

| 端点                           | 能力           |
| ------------------------------ | -------------- |
| `POST /api/plugin/add`         | 新增插件       |
| `POST /api/plugin/http/update` | 更新 HTTP 插件 |
| `POST /api/plugin/code/update` | 更新 Code 插件 |
| `POST /api/plugin/test`        | 插件试运行     |
| `GET  /api/plugin/{id}`        | 插件详情       |
| `POST /api/plugin/delete/{id}` | 删除插件       |
| `POST /api/plugin/publish`     | 发布插件       |

Agent 组件绑定：`POST /api/agent/component/plugin/update`

---

## 三、客户端集成策略

### 3.1 设计原则

```
┌─────────────────────────────────────────────────────────────────┐
│                    客户端（用户电脑 / 云电脑）                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              便捷配置 UI (Configuration Portal)            │   │
│  │  ── 知识库管理 ──    ── 工作流管理 ──    ── 插件管理 ──    │   │
│  │  查看/增删知识库      查看绑定的工作流    查看绑定的插件    │   │
│  │  上传文档             触发试运行         触发试运行        │   │
│  │  查看索引进度         查看运行日志       查看运行日志      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                    NuwaxApiClient 代理转发                       │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              ToolRegistry 工具注册                          │   │
│  │  知识库/工作流/插件 → 注册为可调用工具                      │   │
│  │  ChatEngine 调用时 → 代理到服务器执行                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                      HTTP API 调用
                              │
┌─────────────────────────────────────────────────────────────────┐
│              Nuwax Agent OS（服务器）                              │
│  知识库引擎 / 工作流引擎 / 插件运行时                               │
│  文档解析 · 向量化 · RAG 查询 · 节点执行 · 插件执行               │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 三种集成模式

| 模式         | 描述                                 | 适用场景                      |
| ------------ | ------------------------------------ | ----------------------------- |
| **配置代理** | 客户端 UI 操作 → 调用服务器 API      | 知识库创建/文档上传/插件新增  |
| **调用代理** | ChatEngine 使用工具 → 转发服务器执行 | Chat 中触发工作流/插件/RAG    |
| **状态缓存** | 定期拉取服务器状态并本地缓存         | 展示知识库索引进度/插件可用性 |

---

## 四、知识库集成

### 4.1 KnowledgeSyncAdapter

```typescript
class KnowledgeSyncAdapter {
  constructor(private nuwaxClient: NuwaxApiClient) {}

  /** 拉取 Agent 绑定的知识库列表（用于 UI 展示） */
  async pullKnowledgeList(agentId: number): Promise<KnowledgeInfo[]> {
    const components = await this.nuwaxClient.request<AgentComponentInfo[]>(
      "GET",
      `/api/agent/component/list/${agentId}`,
    );

    const knowledgeComponents = components.filter(
      (c) => c.type === "knowledge",
    );
    const result: KnowledgeInfo[] = [];

    for (const kc of knowledgeComponents) {
      const detail = await this.nuwaxClient.request<KnowledgeInfo>(
        "GET",
        `/api/knowledge/config/${kc.refId}`,
      );
      result.push(detail);
    }

    return result;
  }

  /** 上传文档到知识库（客户端提供便捷上传入口） */
  async uploadDocument(
    knowledgeId: number,
    file: Buffer,
    filename: string,
  ): Promise<void> {
    await this.nuwaxClient.upload(
      `/api/knowledge/document/add`,
      file,
      filename,
    );
  }

  /** 查询文档索引进度 */
  async getDocumentStatus(docId: number): Promise<KnowledgeDocumentInfo> {
    return this.nuwaxClient.request("GET", `/api/knowledge/document/${docId}`);
  }

  /** 绑定知识库到 Agent */
  async bindToAgent(agentId: number, knowledgeIds: number[]): Promise<void> {
    await this.nuwaxClient.request(
      "POST",
      "/api/agent/component/knowledge/update",
      { agentId, knowledgeBaseIds: knowledgeIds },
    );
  }
}
```

### 4.2 ChatEngine 中的 RAG 调用

当 Chat 需要知识库检索时，通过服务器 API 代理执行：

```typescript
class ServerRAGTool implements ToolExecutor {
  constructor(private nuwaxClient: NuwaxApiClient) {}

  /** 作为 ToolRegistry 中的工具被 ChatEngine 调用 */
  async execute(
    args: { query: string; knowledgeId: number },
    context: ToolContext,
  ): Promise<ToolResult> {
    // 委托服务器做 RAG 检索，客户端不做本地向量化
    const result = await this.nuwaxClient.request(
      "POST",
      "/api/knowledge/search",
      {
        knowledgeId: args.knowledgeId,
        query: args.query,
        topK: 5,
      },
    );

    return {
      success: true,
      output: result,
      executionTimeMs: 0,
    };
  }
}
```

---

## 五、工作流集成

### 5.1 WorkflowProxy

```typescript
class WorkflowProxy {
  constructor(private nuwaxClient: NuwaxApiClient) {}

  /** 拉取 Agent 绑定的工作流列表 */
  async pullWorkflowList(agentId: number): Promise<WorkflowInfo[]> {
    const components = await this.nuwaxClient.request<AgentComponentInfo[]>(
      "GET",
      `/api/agent/component/list/${agentId}`,
    );

    const wfComponents = components.filter((c) => c.type === "workflow");
    const result: WorkflowInfo[] = [];

    for (const wc of wfComponents) {
      const detail = await this.nuwaxClient.request<IgetDetails>(
        "GET",
        `/api/workflow/${wc.refId}`,
      );
      result.push({
        id: detail.id,
        name: detail.name,
        description: detail.description,
        nodeCount: detail.nodes?.length || 0,
      });
    }

    return result;
  }

  /** 触发工作流执行（代理到服务器） */
  async executeWorkflow(
    workflowId: number,
    params: Record<string, unknown>,
    requestId: string,
  ): Promise<unknown> {
    return this.nuwaxClient.request("POST", "/api/workflow/test-run", {
      workflowId,
      requestId,
      params,
    });
  }

  /** 绑定工作流到 Agent */
  async bindToAgent(agentId: number, workflowIds: number[]): Promise<void> {
    await this.nuwaxClient.request(
      "POST",
      "/api/agent/component/workflow/update",
      { agentId, workflowIds },
    );
  }
}
```

---

## 六、插件集成

### 6.1 PluginProxy

```typescript
class PluginProxy {
  constructor(private nuwaxClient: NuwaxApiClient) {}

  /** 拉取 Agent 绑定的插件列表 */
  async pullPluginList(agentId: number): Promise<PluginInfo[]> {
    const components = await this.nuwaxClient.request<AgentComponentInfo[]>(
      "GET",
      `/api/agent/component/list/${agentId}`,
    );

    const pluginComponents = components.filter((c) => c.type === "plugin");
    const result: PluginInfo[] = [];

    for (const pc of pluginComponents) {
      const detail = await this.nuwaxClient.request<PluginInfo>(
        "GET",
        `/api/plugin/${pc.refId}`,
      );
      result.push(detail);
    }

    return result;
  }

  /** 插件试运行（代理到服务器） */
  async testPlugin(
    pluginId: number,
    params: Record<string, unknown>,
  ): Promise<PluginTestResult> {
    return this.nuwaxClient.request("POST", "/api/plugin/test", {
      pluginId,
      ...params,
    });
  }

  /** 绑定插件到 Agent */
  async bindToAgent(agentId: number, pluginIds: number[]): Promise<void> {
    await this.nuwaxClient.request(
      "POST",
      "/api/agent/component/plugin/update",
      { agentId, pluginIds },
    );
  }
}
```

---

## 七、IPC 接口设计

```typescript
// Knowledge（配置代理）
'knowledge:list'              → KnowledgeInfo[]
'knowledge:documents'         → KnowledgeDocumentInfo[]
'knowledge:upload'            → { success: boolean }
'knowledge:bind'              → { success: boolean }
'knowledge:status'            → { indexed: number; total: number }

// Workflow（配置代理 + 调用代理）
'workflow:list'               → WorkflowInfo[]
'workflow:execute'            → { requestId: string; result: unknown }
'workflow:bind'               → { success: boolean }

// Plugin（配置代理 + 调用代理）
'plugin:list'                 → PluginInfo[]
'plugin:test'                 → PluginTestResult
'plugin:bind'                 → { success: boolean }
```

---

## 八、UI 设计要点

### 一体化配置面板

客户端提供统一的 Agent 组件配置面板，对应服务器 Agent 编排的 7 个 Tab：

```
┌─ Agent 配置 ──────────────────────────────────────────────┐
│                                                            │
│  [规划] [工具] [技能] [知识] [记忆] [对话] [界面]          │
│                                                            │
│  ── 知识库 ──────────────────────────────────              │
│  │ 产品文档库     │ 12 文档  │ ✅ 索引完成 │ [上传]       │
│  │ API 文档       │ 3 文档   │ ⏳ 索引中   │ [上传]       │
│  │                                      [+ 新建知识库]    │
│                                                            │
│  ── 工作流 ──────────────────────────────────              │
│  │ 数据分析流程   │ 5 节点   │ ✅ 已发布   │ [试运行]     │
│  │ 报告生成流程   │ 8 节点   │ 🔧 开发中   │ [试运行]     │
│  │                                      [+ 绑定工作流]    │
│                                                            │
│  ── 插件 ──────────────────────────────────                │
│  │ 天气查询       │ HTTP     │ ✅ 可用     │ [测试]       │
│  │ 代码执行       │ Code     │ ✅ 可用     │ [测试]       │
│  │                                      [+ 绑定插件]      │
│                                                            │
│  💡 复杂编辑请使用 Web 端:                                  │
│     https://testagent.xspaceagi.com/space/752/agent/276    │
└────────────────────────────────────────────────────────────┘
```

> 💡 设计理念：客户端提供 **80% 场景** 的便捷配置。
> 复杂操作（如工作流节点编排、知识库分段策略）引导用户跳转到 Web 端完成。

---

## 相关文档

- [总体架构](./01-ARCHITECTURE.md)
- [Skills & MCP](./03-SKILLS-MCP.md) — MCP / 技能 / 自学工具
- [会话管理](./04-SESSION-CHAT.md) — ChatEngine 调用工具链
- [Agent 自我进化](./06-SELF-EVOLUTION.md) — 记忆系统
