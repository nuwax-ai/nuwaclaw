---
version: 2.0
last-updated: 2026-03-09
status: design
---

# 06 — Agent 自我进化架构（V2 落地方案）

## 一、与 V1 设计的关系

V1 架构文档（`docs/architecture/`）已定义了完整的自我进化理论框架：

- **OVERVIEW.md** — 产品定位、三区隔离、七层循环
- **COMPONENTS.md** — Memory / Skill Creator / EvoMap / Soul.md 类型定义
- **LOOP.md** — 七层循环流程接口
- **STORAGE.md** — Markdown 存储方案

V2 的目标是**将这些设计落地到本地完整体服务中**，与 `ChatEngine`、`ToolRegistry`、`ModelGateway` 深度集成。

---

## 二、V2 进化引擎架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                     EvolutionEngine (进化引擎)                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ MemoryStore  │  │ EvoMapEngine │  │ SoulManager  │              │
│  │ 记忆系统      │  │ 进化图谱引擎  │  │ 灵魂文件管理  │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│  ┌──────▼─────────────────▼─────────────────▼──────────────────────┐ │
│  │                  Integration Layer (集成层)                       │ │
│  │                                                                  │ │
│  │  ChatEngine  ←──→  EvolutionEngine  ←──→  ToolRegistry          │ │
│  │  (对话时注入记忆)    (执行后编码学习)       (技能CRUD联动)          │ │
│  │                                                                  │ │
│  │  ChannelGateway ←──→  EvolutionEngine                           │ │
│  │  (多渠道经验汇总)      (跨渠道模式发现)                            │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │            Background Tasks (后台任务)                             │ │
│  │  定期反思 · 记忆清理 · 技能优化 · EvoMap 更新                      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 三、与 ChatEngine 集成

### 3.1 ChatPipeline 中的进化钩子

```typescript
/**
 * ChatPipeline 的 PreProcessor 注入进化上下文
 */
class EvolutionPreProcessor implements PipelineStage {
  constructor(
    private memoryStore: MemoryStore,
    private evoMapEngine: EvoMapEngine,
    private soulManager: SoulManager,
  ) {}

  async process(context: ChatContext): Promise<ChatContext> {
    const taskType = await this.classifyTask(context.userMessage);

    // 1. 注入 Soul 上下文
    const soulContext = await this.soulManager.getPromptContext();
    context.systemPromptParts.push(soulContext);

    // 2. 查询相关记忆
    const memories = await this.memoryStore.recall({
      taskType,
      constraints: context.constraints,
      limit: 5,
    });

    if (memories.length > 0) {
      context.systemPromptParts.push(
        `\n## 相关经验\n${memories
          .map((m) => `- [${m.type}] ${m.summary} (置信度: ${m.confidence})`)
          .join("\n")}`,
      );
    }

    // 3. 查询 EvoMap 推荐方案
    const decision = await this.evoMapEngine.getDecision(taskType);
    if (decision && decision.confidence > 0.7) {
      context.systemPromptParts.push(
        `\n## 推荐方案\n根据历史经验，推荐: ${decision.bestAction} (成功率: ${decision.successRate})`,
      );
    }

    return context;
  }
}

/**
 * ChatPipeline 的 PostProcessor 编码学习
 */
class EvolutionPostProcessor implements PipelineStage {
  async process(context: ChatContext): Promise<ChatContext> {
    // 异步执行，不阻塞响应。使用 queueMicrotask + try/catch 确保进化编码失败不影响用户体验
    queueMicrotask(async () => {
      try {
        const outcome = this.extractOutcome(context);

        if (outcome.success) {
          await this.memoryStore.writeSuccess(outcome);
          await this.evoMapEngine.reinforce(outcome);
          await this.soulManager.recordSuccess(outcome);
        } else {
          await this.memoryStore.writeFailure(outcome);
          await this.evoMapEngine.recordFailure(outcome);
          await this.soulManager.recordFailure(outcome);
        }

        // 检查是否可以提取新技能
        if (outcome.success && outcome.toolCalls.length >= 3) {
          await this.tryExtractSkill(outcome);
        }
      } catch (error) {
        // 进化失败不应影响用户体验，仅记录日志
        log.warn("Evolution encoding failed:", error);
      }
    });

    return context;
  }
}
```

### 3.2 Agent Service 集成

当消息路由到**远程 Agent Service**（如 `https://testagent.xspaceagi.com`）时，进化引擎同样可以工作：

```typescript
class RemoteAgentEvolutionAdapter {
  /**
   * 监听远程 Agent 的 SSE 流，从中提取学习数据
   */
  observeRemoteSession(
    sseStream: ReadableStream,
    sessionContext: { taskType: string; userId: string; channelId?: string },
  ): void {
    // 1. 收集 tool_call / text 事件
    // 2. 判断最终结果（成功/失败）
    // 3. 编码为本地记忆
    // 4. 更新 EvoMap
    // → 即使用远程 Agent，本地也能积累经验
  }
}
```

---

## 四、MemoryStore V2

### 4.1 混合存储策略

```
                        MemoryStore
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  Markdown    │ │  SQLite      │ │ sqlite-vec   │
     │  记忆文件     │ │  结构化索引   │ │  向量检索     │
     │ (人类可读)    │ │ (快速查询)    │ │ (语义搜索)    │
     └──────────────┘ └──────────────┘ └──────────────┘
```

- **Markdown 文件**：保留 V1 设计，存储成功/失败记忆的详细内容（人类可读）
- **SQLite 索引表**：快速查询（按 task/type/confidence/时间）
- **sqlite-vec 向量**：语义相似性检索（项目已依赖 `sqlite-vec`）

### 4.2 记忆索引表

```sql
CREATE TABLE memory_entries (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,           -- 'success' | 'failure' | 'insight'
  task_type       TEXT NOT NULL,           -- 任务类型标签
  summary         TEXT NOT NULL,           -- 简要描述
  file_path       TEXT NOT NULL,           -- 对应 Markdown 文件路径
  confidence      REAL DEFAULT 0,
  access_count    INTEGER DEFAULT 0,
  last_accessed   INTEGER,

  -- 上下文
  environment     TEXT,                    -- 环境描述
  constraints     TEXT,                    -- JSON 数组

  -- 动作
  tool_used       TEXT,
  command         TEXT,

  -- 结果
  success         INTEGER,
  time_taken_ms   INTEGER,
  user_feedback   TEXT,                    -- 'positive' | 'negative' | 'neutral'

  -- 来源追溯
  session_id      TEXT,
  channel_id      TEXT,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_memory_task ON memory_entries(task_type);
CREATE INDEX idx_memory_type ON memory_entries(type);
CREATE INDEX idx_memory_confidence ON memory_entries(confidence DESC);
```

### 4.3 向量检索

```typescript
class VectorMemorySearch {
  /**
   * 使用已有的 sqlite-vec 依赖进行语义搜索
   */
  async semanticSearch(
    query: string,
    limit: number = 5,
  ): Promise<MemoryEntry[]> {
    // 1. 使用本地嵌入模型或 Provider API 生成查询向量
    const queryEmbedding = await this.generateEmbedding(query);

    // 2. 使用 sqlite-vec 进行向量近似搜索
    const results = db
      .prepare(
        `
      SELECT m.*, distance
      FROM memory_entries m
      JOIN memory_vectors v ON m.id = v.memory_id
      WHERE v.embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `,
      )
      .all(queryEmbedding, limit);

    return results;
  }

  /**
   * 嵌入生成策略
   * - 优先使用本地模型（Ollama text-embedding）
   * - 回退到 Provider API（OpenAI text-embedding-3-small）
   * - 最后回退到关键词 TF-IDF
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    // ...
  }
}
```

---

## 五、EvoMap V2

### 5.1 与 ToolRegistry 联动

```typescript
class EvoMapEngine {
  private toolRegistry: ToolRegistry;

  /**
   * 当 Agent 使用工具成功时，更新该工具在 EvoMap 中的置信度
   */
  async reinforceTool(toolId: string, outcome: ToolOutcome): Promise<void> {
    const tool = this.toolRegistry.getToolById(toolId);
    if (!tool) return;

    const situation = `use-tool:${tool.name}`;
    const currentNode = await this.getDecisionNode(situation);

    if (outcome.success) {
      currentNode.confidence = Math.min(currentNode.confidence + 0.02, 1.0);
      currentNode.evidence.successCount++;
      tool.metadata.successRate = this.recalculateSuccessRate(tool, true);
    } else {
      currentNode.confidence = Math.max(currentNode.confidence - 0.05, 0.0);
      currentNode.evidence.failureCount++;
      tool.metadata.successRate = this.recalculateSuccessRate(tool, false);
    }

    await this.saveDecisionNode(situation, currentNode);
    await this.toolRegistry.updateToolMetadata(toolId, tool.metadata);
  }

  /**
   * 为给定任务推荐最佳工具组合
   */
  async recommendTools(taskType: string): Promise<ToolRecommendation[]> {
    const decisionNode = await this.getDecisionNode(taskType);

    return decisionNode.options
      .filter((opt) => opt.confidence > 0.5)
      .sort((a, b) => b.confidence - a.confidence)
      .map((opt) => ({
        toolId: opt.action,
        confidence: opt.confidence,
        expectedSuccessRate: opt.expectedSuccessRate,
        reason: `${opt.evidence.successCount} 次成功 / ${opt.evidence.failureCount} 次失败`,
      }));
  }
}
```

### 5.2 跨 Channel 模式发现

```typescript
/**
 * 当同一个 Agent 被多个 Channel 使用时，
 * 跨 Channel 的使用模式可以帮助发现更通用的最佳实践。
 */
class CrossChannelAnalyzer {
  async analyzePatterns(): Promise<CrossChannelInsight[]> {
    const memories = await this.memoryStore.query({
      groupBy: "channel_id",
      minEntries: 10,
    });

    const insights: CrossChannelInsight[] = [];

    // 发现所有 Channel 共同的成功模式
    const commonSuccessPatterns = this.findCommonPatterns(
      memories.filter((m) => m.success),
    );

    for (const pattern of commonSuccessPatterns) {
      if (pattern.coverage > 0.8) {
        // 80% 以上 Channel 都验证过
        insights.push({
          type: "universal-pattern",
          description: pattern.description,
          confidence: pattern.confidence,
          channels: pattern.channels,
        });
      }
    }

    return insights;
  }
}
```

---

## 六、Soul.md V2

### 6.1 扩展 Soul 内容

```markdown
---
name: soul
version: 42
last-updated: 2026-03-09
---

# Soul.md - Agent 自我认知

## 身份

我是 Nuwax Agent，在 NuwaClaw 桌面应用中运行的 AI 助手。

## 我的服务端点

- 本地推理: OpenAI (gpt-4o) · Anthropic (claude-sonnet-4)
- 远程 Agent: https://testagent.xspaceagi.com

## 我的 Channel

- 飞书 Bot: 服务 23 个用户, 回复 1,234 条消息
- 钉钉 Bot: 服务 12 个用户, 回复 567 条消息

## 核心原则

1. 用户目标优先
2. 优先使用验证过的工具和方法
3. 失败时尝试备选方案
4. 记录所有尝试以供学习
5. 【新增】同一任务跨 Channel 验证后可提升置信度

## 工具掌握度

| 工具       | 使用次数 | 成功率 | 最后使用   |
| ---------- | -------- | ------ | ---------- |
| parse-json | 234      | 98%    | 2026-03-08 |
| install-uv | 89       | 95%    | 2026-03-07 |
| web-search | 156      | 87%    | 2026-03-09 |

## 最近学到的教训

- `2026-03-08`: 处理大文件时应分块读取，避免内存溢出
- `2026-03-07`: 飞书卡片消息对 Markdown 表格支持有限，改用 text 格式

## 统计数据

- 总任务数: 2,345
- 成功率: 91.2%
- 服务 Channel: 2 个
- 活跃用户: 35 人
```

### 6.2 SoulManager V2

```typescript
class SoulManagerV2 {
  private soulUpdater: SoulUpdater;

  /**
   * 生成注入到 ChatPipeline 的 Soul 上下文
   * 根据当前对话的 Channel、用户、任务类型动态裁剪
   */
  async getPromptContext(context: {
    channelId?: string;
    userId?: string;
    taskType?: string;
  }): Promise<string> {
    const soul = await this.loadSoul();

    let prompt = `## Agent 身份\n${soul.identity}\n`;
    prompt += `\n## 核心原则\n${soul.principles.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n`;

    // 按任务类型注入相关技能
    if (context.taskType) {
      const relevantTools = soul.toolProficiency
        .filter((t) => t.taskTypes.includes(context.taskType!))
        .sort((a, b) => b.successRate - a.successRate)
        .slice(0, 5);

      if (relevantTools.length > 0) {
        prompt += `\n## 推荐工具\n${relevantTools
          .map((t) => `- ${t.name} (成功率: ${t.successRate}%)`)
          .join("\n")}\n`;
      }
    }

    // 按 Channel 注入特定经验
    if (context.channelId) {
      const channelLessons = soul.lessons
        .filter((l) => l.channelId === context.channelId)
        .slice(-3);

      if (channelLessons.length > 0) {
        prompt += `\n## 该渠道注意事项\n${channelLessons
          .map((l) => `- ${l.lesson}`)
          .join("\n")}\n`;
      }
    }

    return prompt;
  }
}
```

---

## 七、后台任务

```typescript
class EvolutionScheduler {
  /**
   * 注册后台进化任务
   */
  start(): void {
    // 每日反思
    setInterval(() => this.dailyReflection(), 24 * 60 * 60 * 1000);

    // 每小时记忆清理（轻量）
    setInterval(() => this.memoryCleanup(), 60 * 60 * 1000);

    // 每 50 次任务触发技能优化
    this.taskCounter.on("milestone:50", () => this.optimizeSkills());
  }

  async dailyReflection(): Promise<void> {
    log.info("[Evolution] Starting daily reflection...");

    // 1. 收集最近 24h 的记忆
    const recentMemories = await this.memoryStore.getRecent(
      24 * 60 * 60 * 1000,
    );

    // 2. 分析模式
    const patterns = this.analyzePatterns(recentMemories);

    // 3. 更新 EvoMap
    for (const pattern of patterns.success) {
      await this.evoMapEngine.reinforcePattern(pattern);
    }
    for (const pattern of patterns.failure) {
      await this.evoMapEngine.recordAntiPattern(pattern);
    }

    // 4. 更新 Soul.md
    const reflection = {
      insights: patterns.insights,
      newPrinciples: patterns.principles,
      toolUpdates: patterns.toolUpdates,
    };
    await this.soulManager.updateReflection(reflection);

    // 5. 跨 Channel 分析
    const crossChannelInsights =
      await this.crossChannelAnalyzer.analyzePatterns();
    if (crossChannelInsights.length > 0) {
      await this.soulManager.addInsights(crossChannelInsights);
    }

    log.info(
      `[Evolution] Reflection complete: ${patterns.insights.length} insights`,
    );
  }
}
```

---

## 八、IPC 接口设计

```typescript
// Memory
'evolution:memory:search'     → MemoryEntry[]
'evolution:memory:recent'     → MemoryEntry[]
'evolution:memory:stats'      → MemoryStats

// EvoMap
'evolution:evomap:decision'   → DecisionNode
'evolution:evomap:recommend'  → ToolRecommendation[]

// Soul
'evolution:soul:get'          → SoulContent
'evolution:soul:stats'        → SoulStats

// Dashboard
'evolution:dashboard'         → EvolutionDashboard

// Control
'evolution:reflect:trigger'   → ReflectionResult
'evolution:reset'             → { success: boolean }
'evolution:export'            → { data: string }  // JSON export
'evolution:import'            → { success: boolean }
```

---

## 相关文档

- [V1 总览](../architecture/OVERVIEW.md)
- [V1 核心组件](../architecture/COMPONENTS.md)
- [V1 循环流程](../architecture/LOOP.md)
- [V1 存储实现](../architecture/STORAGE.md)
- [Skills & MCP](./03-SKILLS-MCP.md)
- [会话管理](./04-SESSION-CHAT.md)
- [Channel 接入](./05-CHANNELS.md)
