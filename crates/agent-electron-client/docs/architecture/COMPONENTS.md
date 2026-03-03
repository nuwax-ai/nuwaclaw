---
version: 1.0
last-updated: 2026-02-24
status: design
---

# Agent 自我进化架构 - 核心组件

## 概述

本文档详细介绍 Nuwax Agent 自我进化系统的四大核心组件：Memory（记忆系统）、Skill Creator（技能创造器）、EvoMap（进化图谱）和 Soul.md（灵魂文件）。

---

## 1. Memory（记忆系统）

### 1.1 记忆层级结构

```typescript
interface AgentMemory {
  // 短期记忆：当前会话
  working: {
    context: string[];
    recentActions: Action[];
    currentGoal: Goal;
  };

  // 中期记忆：跨会话
  session: {
    successfulPatterns: Pattern[];
    failedAttempts: FailedAttempt[];
    userPreferences: UserPreference[];
  };

  // 长期记忆：固化的知识
  longTerm: {
    skills: Skill[];          // 已验证的技能
    principles: Principle[];   // 学习到的原则
    antiPatterns: AntiPattern[];  // 避免的陷阱
  };
}
```

### 1.2 记忆编码格式

```typescript
interface EncodedMemory {
  id: string;
  type: 'success' | 'failure' | 'insight';
  embedding?: number[];       // 语义向量，用于相似性检索（可选）
  context: {
    task: string;             // 任务类型
    environment: string;      // 环境信息
    constraints: string[];    // 约束条件
  };
  action: {
    tool: string;             // 使用的工具
    command: string;          // 执行命令
    parameters: Record<string, unknown>;
  };
  outcome: {
    success: boolean;
    timeTaken: number;
    error?: string;
    userFeedback?: 'positive' | 'negative' | 'neutral';
  };
  timestamp: number;
  accessCount: number;        // 访问频率
  lastAccessed: number;
}
```

### 1.3 记忆检索接口

```typescript
interface MemoryReader {
  // 语义检索
  recall(query: {
    situation: string;
    taskType: string;
    constraints: string[];
  }): RecallResult;

  // 获取相似记忆
  getSimilarMemories(memory: EncodedMemory, limit?: number): EncodedMemory[];

  // 获取相关决策
  getDecision(task: string): DecisionNode;

  // 清理过期记忆
  cleanup(policy: MemoryCleanupPolicy): Promise<CleanupResult>;
}

interface RecallResult {
  evoMap: DecisionNode;
  skills: Skill[];
  cases: {
    successes: EncodedMemory[];
    failures: EncodedMemory[];
  };
  confidence: number;
}
```

---

## 2. Skill Creator（技能创造器）

### 2.1 技能定义

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;           // 'file' | 'network' | 'system' | 'ai'

  // 技能定义
  definition: {
    trigger: Condition[];     // 触发条件
    steps: SkillStep[];       // 执行步骤
    fallback?: SkillStep[];   // 失败时的备选
  };

  // 技能元数据
  metadata: {
    createdFrom: string;      // 来源记忆 ID
    successRate: number;      // 成功率
    avgTime: number;          // 平均执行时间
    lastUsed: number;
    version: number;
  };
}

interface SkillStep {
  tool: string;
  command: string;
  parameters: Record<string, unknown>;
  fallback?: SkillStep[];
}
```

### 2.2 技能创造器接口

```typescript
interface SkillCreator {
  // 从成功经验中提取技能
  extractSkill(memory: EncodedMemory[]): Skill;

  // 从失败经验中创造技能
  createFromFailure(failure: FailedAttempt, context: CreationContext): Skill;

  // 组合现有技能创造新技能
  combineSkills(skills: Skill[]): Skill;

  // 优化技能（减少步骤、提高成功率）
  optimizeSkill(skill: Skill, history: ActionResult[]): Skill;

  // 验证技能有效性
  validateSkill(skill: Skill): Promise<boolean>;

  // 从模式创建技能
  fromPattern(pattern: SuccessPattern): Skill;
}
```

### 2.3 技能进化示例

```typescript
// 初始技能（从成功经验提取）
const skill_v1: Skill = {
  name: "parse-json-file",
  steps: [
    { tool: "read", params: { path: "${file}" } },
    { tool: "jq", params: { expr: "." } },  // 需要安装 jq
  ],
  successRate: 0.6,  // 60% 成功率（jq 可能不存在）
};

// 优化后的技能（学习失败经验）
const skill_v2: Skill = {
  name: "parse-json-file",
  steps: [
    { tool: "read", params: { path: "${file}" } },
    {
      tool: "node",
      params: { eval: "JSON.parse(require('fs').readFileSync('${file}'))" },
      fallback: [
        { tool: "install", params: { package: "jq" } },
        { tool: "jq", params: { expr: "." } },
      ]
    },
  ],
  successRate: 0.95,  // 95% 成功率
  version: 2,
};
```

---

## 3. EvoMap（进化图谱）

### 3.1 进化图谱定义

```typescript
interface EvoMap {
  // 决策树：在不同情况下的最佳路径
  decisionTree: DecisionNode;

  // 成功模式库
  successPatterns: Map<string, SuccessPattern>;

  // 失败模式库
  failurePatterns: Map<string, FailurePattern>;
}

interface DecisionNode {
  situation: string;          // 当前情况描述
  options: DecisionOption[];
}

interface DecisionOption {
  action: string;
  confidence: number;         // 基于历史数据的置信度
  expectedSuccessRate: number;
  expectedTime: number;

  // 参考证据
  evidence: {
    successCount: number;
    failureCount: number;
    similarCases: string[];   // 相似历史案例 ID
  };

  // 后续节点
  next?: DecisionNode;
}
```

### 3.2 EvoMap 结构示例

```typescript
// 任务：安装 Python 包
const evoMap_install_python = {
  situation: "需要安装 Python 包",

  options: [
    {
      action: "使用 uv pip install",
      confidence: 0.95,
      expectedSuccessRate: 0.98,
      expectedTime: 5,
      evidence: {
        successCount: 45,
        failureCount: 1,
        similarCases: ['mem_45', 'mem_67', 'mem_89'],
      },
    },
    {
      action: "使用 pip install",
      confidence: 0.7,
      expectedSuccessRate: 0.8,
      expectedTime: 10,
      evidence: {
        successCount: 30,
        failureCount: 7,
        similarCases: ['mem_23', 'mem_34'],
      },
      next: {
        situation: "pip 不存在",
        options: [
          {
            action: "切换到 uv",
            confidence: 0.99,
            evidence: { successCount: 15, failureCount: 0 },
          },
        ],
      },
    },
    {
      action: "使用系统包管理器",
      confidence: 0.5,
      expectedSuccessRate: 0.6,
      expectedTime: 30,
      evidence: {
        successCount: 10,
        failureCount: 8,
        similarCases: ['mem_12'],
      },
      reason: "最后手段，可能需要 sudo",
    },
  ],
};
```

### 3.3 EvoMap 管理接口

```typescript
interface EvoMapManager {
  // 更新决策
  updateEvoMap(outcome: Outcome): Promise<void>;

  // 获取最佳行动
  getBestAction(situation: string): Promise<Action>;

  // 获取备选方案
  getAlternatives(action: string): Promise<DecisionOption[]>;

  // 调整优先级
  adjustPriority(action: string, delta: number): Promise<void>;

  // 获取决策节点
  getDecisionNode(task: string): DecisionNode;
}
```

---

## 4. Soul.md（灵魂文件）

### 4.1 Soul.md 结构

```markdown
---
name: soul
version: 3
last-updated: 2024-02-24
---

# Soul.md - Agent 自我认知

## 身份
我是 Nuwax Agent，一个可以自我进化的 AI 助手。

## 核心原则
1. 用户目标优先
2. 优先使用验证过的方法
3. 失败时尝试备选方案
4. 记录所有尝试以供学习

## 我的能力
- [x] 文件操作
- [x] 代码执行
- [x] 工具安装
- [x] 自我诊断

## 我的限制
- [ ] 不能写入系统目录
- [ ] 网络下载需要用户确认
- [ ] 资源使用有限制

## 学习到的经验

### 成功模式
- `2024-02-24`: 使用 uv pip 安装 Python 包，98% 成功率
  - 参考: `memory/successes/2024-02-24-install-uv.md`
- `2024-02-24`: 使用 node 内置 JSON 解析，避免 jq 依赖

### 失败教训
- `2024-02-23`: 尝试直接写入 /usr/lib 失败 → 使用工作区

### 技能清单
- `parse-json` - JSON 文件解析（已学会）
- `install-uv` - Python 包安装（已学会）
- `grep-log` - 日志文件分析（已学会）

## 统计数据
- 总任务数: 1,234
- 成功率: 87.5%
- 最常用方法: uv pip install (45次)
- 最省时方法: node JSON parse (平均 0.5s)
```

### 4.2 Soul 管理接口

```typescript
interface SoulManager {
  // 成功时更新
  recordSuccess(outcome: SuccessfulOutcome): Promise<void>;

  // 失败时学习
  recordFailure(error: Error, context: string): Promise<void>;

  // 更新洞察
  update(insight: string): Promise<void>;

  // 更新反模式
  updateAntiPattern(antiPattern: AntiPattern): Promise<void>;

  // 定期反思
  reflect(): Promise<Reflection>;

  // 自我修复
  selfRepair(issue: DetectedIssue): Promise<RepairAction>;

  // 获取当前状态
  getStatus(): SoulStatus;
}

interface Reflection {
  insights: string[];         // 新的洞察
  skillUpdates: SkillUpdate[]; // 技能更新建议
  antiPatterns: AntiPattern[]; // 发现的反模式
  principles: string[];       // 提炼的原则
  recommendations: string[];  // 改进建议
}
```

### 4.3 并发控制

Soul 文件可能被多个组件同时更新，需要引入并发控制机制：

```typescript
/**
 * Soul 更新器（带并发控制）
 *
 * 问题：多个组件可能同时更新 Soul.md
 * - recordSuccess() 执行中
 * - reflect() 定期触发
 * - updateAntiPattern() 被调用
 *
 * 解决：使用 Promise 排队确保更新顺序
 */
class SoulUpdater {
  private lock: Promise<void> | null = null;

  async update(update: SoulUpdate): Promise<void> {
    // 等待现有更新完成
    if (this.lock) {
      await this.lock;
    }

    // 执行更新
    this.lock = (async () => {
      await this.writeSoul(update);
      this.lock = null;
    })();

    return this.lock;
  }

  private async writeSoul(update: SoulUpdate): Promise<void> {
    // 读取当前内容
    const current = await fs.readFile('soul/soul.md', 'utf-8');

    // 应用更新
    const updated = this.applyUpdate(current, update);

    // 写入文件
    await fs.writeFile('soul/soul.md', updated, 'utf-8');
  }

  private applyUpdate(content: string, update: SoulUpdate): string {
    // 解析 frontmatter
    const { frontmatter, body } = this.parseMarkdown(content);

    // 更新 version 和 last-updated
    frontmatter.version = (parseInt(frontmatter.version) + 1).toString();
    frontmatter['last-updated'] = new Date().toISOString().split('T')[0];

    // 应用具体更新
    switch (update.type) {
      case 'success':
        body.successes.push(update.entry);
        break;
      case 'insight':
        body.insights.push(update.entry);
        break;
      case 'anti-pattern':
        body.antiPatterns.push(update.entry);
        break;
    }

    // 重新组装
    return this.formatMarkdown(frontmatter, body);
  }
}

// 使用示例
const soulUpdater = new SoulUpdater();

// 并发调用安全
await Promise.all([
  soulUpdater.update({ type: 'success', entry: { ... } }),
  soulUpdater.update({ type: 'insight', entry: { ... } }),
  soulUpdater.update({ type: 'anti-pattern', entry: { ... } }),
]);
// 所有更新将按顺序执行，不会冲突
```

---

## 组件交互

### 创建新技能流程

```typescript
// 1. 从成功经验提取
const successMemory = await memory.recall({ taskType: 'parse-json' });
const skill = await skillCreator.extractSkill(successMemory.cases.successes);

// 2. 验证技能
if (await skillCreator.validateSkill(skill)) {
  // 3. 保存技能
  await memory.addSkill(skill);

  // 4. 更新 EvoMap
  await evoMap.update({
    situation: 'parse-json',
    action: skill.name,
    outcome: 'success',
  });

  // 5. 更新 Soul
  await soul.update(`学会新技能: ${skill.name}`);
}
```

### 决策流程

```typescript
// 1. 查询 EvoMap
const decision = await evoMap.getDecision('install-python-package');

// 2. 选择最佳方案
const bestOption = decision.options
  .sort((a, b) => b.confidence - a.confidence)[0];

// 3. 检查是否有对应技能
const skill = await memory.getSkill(bestOption.action);

// 4. 返回执行计划
return {
  action: bestOption.action,
  steps: skill?.definition.steps || genericSteps,
  confidence: bestOption.confidence,
};
```

---

## 技能生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                    技能生命周期                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  创造阶段                                                     │
│  - 从成功经验提取                                             │
│  - 从失败经验创造                                             │
│  - 组合现有技能                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  验证阶段                                                     │
│  - 测试执行                                                   │
│  - 评估成功率                                                 │
│  - 记录性能数据                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  部署阶段                                                     │
│  - 保存到技能库                                               │
│  - 更新 EvoMap                                               │
│  - 通知 Soul                                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  优化阶段                                                     │
│  - 收集执行数据                                               │
│  - 分析失败模式                                               │
│  - 迭代升级                                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## TODO

### 类型定义统一

创建基础类型定义文件，集中管理进化系统相关的类型：

```typescript
// TODO: 创建 src/shared/types/evolution.ts

/**
 * Agent 自我进化系统 - 基础类型定义
 *
 * 此文件集中定义所有核心组件共用的类型，避免重复定义和不一致。
 */

// ============ Memory ============

export interface EncodedMemory {
  id: string;
  type: 'success' | 'failure' | 'insight';
  embedding?: number[];
  context: {
    task: string;
    environment: string;
    constraints: string[];
  };
  action: {
    tool: string;
    command: string;
    parameters: Record<string, unknown>;
  };
  outcome: {
    success: boolean;
    timeTaken: number;
    error?: string;
    userFeedback?: 'positive' | 'negative' | 'neutral';
  };
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

export interface MemoryCleanupPolicy {
  maxShortTermEntries: number;
  maxLongTermEntries: number;
  maxAge: number;
  lowConfidenceThreshold: number;
}

// ============ Skill ============

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: 'file' | 'network' | 'system' | 'ai';
  definition: {
    trigger: Condition[];
    steps: SkillStep[];
    fallback?: SkillStep[];
  };
  metadata: {
    createdFrom: string;
    successRate: number;
    avgTime: number;
    lastUsed: number;
    version: number;
  };
}

export interface SkillStep {
  tool: string;
  command: string;
  parameters: Record<string, unknown>;
  fallback?: SkillStep[];
}

export type Condition = {
  field: string;
  operator: 'eq' | 'ne' | 'contains' | 'matches';
  value: unknown;
};

// ============ EvoMap ============

export interface EvoMap {
  decisionTree: DecisionNode;
  successPatterns: Map<string, SuccessPattern>;
  failurePatterns: Map<string, FailurePattern>;
}

export interface DecisionNode {
  situation: string;
  options: DecisionOption[];
}

export interface DecisionOption {
  action: string;
  confidence: number;
  expectedSuccessRate: number;
  expectedTime: number;
  evidence: {
    successCount: number;
    failureCount: number;
    similarCases: string[];
  };
  next?: DecisionNode;
}

export interface SuccessPattern {
  id: string;
  situation: string;
  action: string;
  confidence: number;
  applicability: number;
}

export interface FailurePattern {
  id: string;
  situation: string;
  action: string;
  reason: string;
  suggestedAlternative: string;
}

// ============ Soul ============

export interface SoulUpdate {
  type: 'success' | 'insight' | 'anti-pattern' | 'reflection';
  entry: unknown;
  timestamp?: number;
}

export interface SoulStatus {
  version: number;
  lastUpdated: string;
  totalTasks: number;
  successRate: number;
  skillsCount: number;
}

export interface Reflection {
  insights: string[];
  skillUpdates: SkillUpdate[];
  antiPatterns: AntiPattern[];
  principles: string[];
  recommendations: string[];
}

export interface SkillUpdate {
  type: 'create' | 'update' | 'remove';
  skill: Skill;
}

export interface AntiPattern {
  pattern: string;
  reason: string;
  alternative: string;
}

// ============ Loop ============

export interface PerceptionResult {
  context: {
    taskType: string;
    complexity: 'low' | 'medium' | 'high';
    constraints: string[];
    resources: ResourceState;
  };
  urgency: 'immediate' | 'normal' | 'low';
  similarHistory: EncodedMemory[];
}

export interface ResourceState {
  diskSpace: number;
  memoryAvailable: number;
  cpuUsage: number;
}

export interface Plan {
  id: string;
  description: string;
  steps: ExecutionStep[];
  confidence: number;
  expectedSuccessRate: number;
  expectedTime: number;
  expectedResourceUsage: ResourceUsage;
  risks: Risk[];
  fallback?: string;
}

export interface ExecutionStep {
  tool: string;
  command: string;
  parameters: Record<string, unknown>;
  timeout?: number;
}

export interface ResourceUsage {
  disk: number;
  memory: number;
  cpu: number;
  network?: number;
}

export interface Risk {
  type: string;
  description: string;
  mitigation?: string;
}

export interface ExecutionResult {
  status: 'success' | 'failure' | 'partial';
  output?: unknown;
  error?: Error;
  timeTaken: number;
  resourceUsed: ResourceUsage;
  stepsCompleted: number;
  stepsTotal: number;
  trace: ExecutionTrace;
}

export interface ExecutionTrace {
  steps: Array<{
    step: ExecutionStep;
    status: 'success' | 'failure' | 'skipped';
    timeTaken: number;
    output?: unknown;
    error?: Error;
  }>;
}

// ============ Common ============

export interface FailedAttempt {
  id: string;
  task: string;
  error: string;
  timestamp: number;
}

export interface UserPreference {
  key: string;
  value: unknown;
  source: 'explicit' | 'learned';
}

export interface Principle {
  id: string;
  statement: string;
  confidence: number;
  source: string;
}

export type Goal = {
  id: string;
  description: string;
  priority: number;
  deadline?: number;
};

export type Action = {
  type: string;
  params: Record<string, unknown>;
};

export type Outcome = {
  success: boolean;
  data: unknown;
  error?: string;
};
```

**预期文件路径**: `src/shared/types/evolution.ts`

**预期优先级**: P1 - 核心组件实现前完成

---

## 相关文档

- [总览](./OVERVIEW.md) - 产品定位、核心原则、架构图
- [循环流程](./LOOP.md) - 完整循环流程、接口定义、数据流
- [存储实现](./STORAGE.md) - Markdown 格式、索引机制
- [隔离策略](./ISOLATION.md) - 三区模型、环境变量
