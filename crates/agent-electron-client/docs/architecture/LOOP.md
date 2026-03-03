---
version: 1.0
last-updated: 2026-02-24
status: design
---

# Agent 自我进化架构 - 完整循环流程

## 概述

本文档详细描述 Nuwax Agent 自我进化的完整循环流程，包括七层循环架构、接口定义和数据流。

---

## 七层循环架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AGENT 自我进化 LOOP                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Layer 1: 感知层 (Perceive)                                         │  │
│  │  • 收集任务输入、环境状态、用户反馈                                   │  │
│  │  • 构建执行上下文                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                        ↓                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Layer 2: 记忆层 (Recall)                                          │  │
│  │  • 查询 EvoMap: "类似情况下，什么方法有效？"                         │  │
│  │  • 检索可用技能                                                     │  │
│  │  • 获取历史案例                                                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                        ↓                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Layer 3: 规划层 (Plan)                                            │  │
│  │  • 生成多个候选方案                                                 │  │
│  │  • 按置信度排序                                                     │  │
│  │  • 选择最佳方案                                                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                        ↓                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Layer 4: 执行层 (Act)                                             │  │
│  │  • 执行选定的方案                                                   │  │
│  │  • 实时监控异常、超时、资源使用                                      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                        │                                 │
│                            ┌───────────┴───────────┐                    │
│                            │                       │                    │
│                        ┌───▼────┐            ┌───▼────┐                │
│                        │ 成功   │            │ 失败   │                │
│                        └───┬────┘            └───┬────┘                │
│                            │                   │                      │
│                            ▼                   ▼                      │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐    │
│  │  Layer 5: 强化学习 (Reinforce) │  │  Layer 6: 自我修复 (Repair)   │    │
│  │  • 编码成功记忆               │  │  • 分析失败原因               │    │
│  │  • 更新 EvoMap 置信度         │  │  • 查询备选方案               │    │
│  │  • 提取/优化技能             │  │  • 尝试备选方案               │    │
│  │  • 更新 Soul.md              │  │  • 记录失败教训               │    │
│  └──────────────┬──────────────┘  └──────────────┬──────────────┘    │
│                 │                                │                    │
│                 └────────────┬───────────────────┘                    │
│                              ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Layer 7: 反思层 (Reflect)                                         │  │
│  │  • 定期反思（每 N 次任务或每天）                                    │  │
│  │  • 发现模式、生成洞察、提炼原则                                      │  │
│  │  • 更新 Soul.md                                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              ↓                                         │
│                        更新记忆/EvoMap/Soul                              │
│                              ↓                                         │
│                        下次任务更聪明                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 接口定义

### 1. 感知层 (Perceive)

```typescript
interface PerceptionLayer {
  // 收集所有输入
  perceive(input: {
    task: Task;
    environment: EnvironmentState;
    userFeedback?: UserFeedback;
  }): Promise<PerceptionResult>;
}

interface PerceptionResult {
  context: {
    taskType: string;           // 'file-parse' | 'code-gen' | 'debug'
    complexity: 'low' | 'medium' | 'high';
    constraints: string[];
    resources: ResourceState;
  };
  urgency: 'immediate' | 'normal' | 'low';
  similarHistory: EncodedMemory[];  // 相似历史经验
}

interface EnvironmentState {
  platform: string;
  availableTools: string[];
  diskSpace: number;
  networkAvailable: boolean;
}
```

### 2. 记忆层 (Recall)

```typescript
interface RecallLayer {
  // 语义检索
  recall(query: {
    situation: string;
    taskType: string;
    constraints: string[];
  }): Promise<RecallResult>;
}

interface RecallResult {
  // 决策数据
  evoMap: DecisionNode;

  // 可用技能
  skills: Skill[];

  // 历史案例
  cases: {
    successes: EncodedMemory[];
    failures: EncodedMemory[];
  };

  // 置信度
  confidence: number;
}
```

### 3. 规划层 (Plan)

```typescript
interface PlanLayer {
  // 生成候选方案
  generatePlans(
    context: PerceptionResult,
    memory: RecallResult
  ): Promise<Plan[]>;
}

interface Plan {
  id: string;
  description: string;

  // 执行步骤
  steps: ExecutionStep[];

  // 预期
  confidence: number;
  expectedSuccessRate: number;
  expectedTime: number;
  expectedResourceUsage: ResourceUsage;

  // 风险
  risks: Risk[];

  // 备选方案
  fallback?: string;
}

interface ExecutionStep {
  tool: string;
  command: string;
  parameters: Record<string, unknown>;
  timeout?: number;
}
```

### 4. 执行层 (Act)

```typescript
interface ActLayer {
  // 执行计划
  execute(plan: Plan): Promise<ExecutionResult>;

  // 实时监控
  monitor(execution: Execution): MonitoringStream;

  // 中止执行
  abort(executionId: string): Promise<void>;
}

interface ExecutionResult {
  status: 'success' | 'failure' | 'partial';

  // 结果数据
  output?: unknown;
  error?: Error;

  // 执行元数据
  timeTaken: number;
  resourceUsed: ResourceUsage;
  stepsCompleted: number;
  stepsTotal: number;

  // 执行轨迹（用于学习）
  trace: ExecutionTrace;
}

interface ExecutionTrace {
  steps: {
    step: ExecutionStep;
    status: 'success' | 'failure' | 'skipped';
    timeTaken: number;
    output?: unknown;
    error?: Error;
  }[];
}
```

### 5. 自我修复层 (Repair)

```typescript
interface RepairLayer {
  // 尝试修复失败
  repair(failure: ExecutionFailure): Promise<RepairResult>;
}

interface ExecutionFailure {
  plan: Plan;
  error: Error;
  trace: ExecutionTrace;
  context: PerceptionResult;
}

interface RepairResult {
  status: 'repaired' | 'failed' | 'escalated';

  // 修复结果
  output?: unknown;
  finalPlan?: Plan;

  // 学习数据
  learned: {
    whatFailed: string;
    whatWorked: string;
    insight: string;
  };
}

// 修复逻辑示例
async function repair(failure: ExecutionFailure): Promise<RepairResult> {
  const { plan, error, trace, context } = failure;

  // 1. 分析失败原因
  const diagnosis = diagnoseFailure(error, trace);

  // 2. 查询备选方案
  const alternatives = await getAlternativePlans(plan, diagnosis);

  // 3. 尝试备选方案
  for (const altPlan of alternatives) {
    log.info(`修复尝试: ${altPlan.description}`);

    try {
      const result = await execute(altPlan);
      if (result.status === 'success') {
        return {
          status: 'repaired',
          output: result.output,
          finalPlan: altPlan,
          learned: {
            whatFailed: plan.description,
            whatWorked: altPlan.description,
            insight: `${diagnosis.reason} → 使用 ${altPlan.description} 成功`,
          },
        };
      }
    } catch (e) {
      log.info(`修复尝试失败: ${e.message}`);
      continue;
    }
  }

  // 4. 所有修复尝试都失败了
  await memory.recordFailure({
    plan: plan.description,
    error: diagnosis.reason,
    attempted: alternatives.map(a => a.description),
  });

  return {
    status: 'escalated',
    learned: {
      whatFailed: plan.description,
      whatWorked: '无',
      insight: `需要用户干预: ${diagnosis.reason}`,
    },
  };
}
```

### 6. 强化学习层 (Reinforce)

```typescript
interface ReinforceLayer {
  // 处理成功结果
  reinforce(success: ExecutionSuccess): Promise<void>;

  // 处理修复后的结果
  reinforceRepair(repair: RepairResult): Promise<void>;
}

interface ExecutionSuccess {
  plan: Plan;
  result: ExecutionResult;
  context: PerceptionResult;
}

async function reinforce(success: ExecutionSuccess): Promise<void> {
  const { plan, result, context } = success;

  // 1. 编码成功记忆
  const memory: EncodedMemory = {
    id: generateId(),
    type: 'success',
    context: {
      task: context.taskType,
      environment: context.environment,
      constraints: context.constraints,
    },
    action: {
      tool: plan.steps[0]?.tool || 'unknown',
      command: plan.description,
      parameters: {},
    },
    outcome: {
      success: true,
      timeTaken: result.timeTaken,
    },
    timestamp: Date.now(),
  };

  await memory.store(memory);

  // 2. 更新 EvoMap
  await evoMap.update({
    situation: context.taskType,
    action: plan.description,
    outcome: 'success',
    confidence: Math.min(plan.confidence + 0.05, 1.0),
  });

  // 3. 提取或优化技能
  if (result.trace.steps.length > 3) {
    const skill = await skillCreator.extract(result.trace, context);
    if (skill) {
      await memory.addSkill(skill);
      await soul.update(`学会新技能: ${skill.name}`);
    }
  }

  // 4. 更新 Soul.md
  await soul.updateSuccess({
    task: context.taskType,
    method: plan.description,
    effectiveness: result.timeTaken < 5000 ? 'excellent' : 'good',
  });
}
```

### 7. 反思层 (Reflect)

```typescript
interface ReflectLayer {
  // 触发反思
  reflect(): Promise<Reflection>;
}

interface Reflection {
  insights: string[];          // 新洞察
  skillUpdates: SkillUpdate[]; // 技能更新
  antiPatterns: AntiPattern[]; // 发现的反模式
  principles: string[];        // 提炼的原则
  recommendations: string[];   // 改进建议
}

// 反思逻辑（定期触发）
async function reflect(): Promise<Reflection> {
  const reflection: Reflection = {
    insights: [],
    skillUpdates: [],
    antiPatterns: [],
    principles: [],
    recommendations: [],
  };

  // 1. 分析最近的成功案例
  const recentSuccesses = await memory.getRecent('success', 50);
  const successPatterns = analyzePatterns(recentSuccesses);

  for (const pattern of successPatterns) {
    if (pattern.confidence > 0.9) {
      reflection.principles.push(
        `对于 ${pattern.situation} 任务，${pattern.action} 的成功率为 ${pattern.confidence}`
      );

      if (pattern.applicability > 0.7) {
        const skill = await skillCreator.fromPattern(pattern);
        reflection.skillUpdates.push({ type: 'create', skill });
      }
    }
  }

  // 2. 分析最近的失败案例
  const recentFailures = await memory.getRecent('failure', 50);
  const failurePatterns = analyzePatterns(recentFailures);

  for (const pattern of failurePatterns) {
    if (pattern.frequency > 3) {
      reflection.antiPatterns.push({
        pattern: pattern.description,
        reason: pattern.reason,
        alternative: pattern.suggestedAlternative,
      });

      await soul.updateAntiPattern({
        avoid: pattern.description,
        use: pattern.suggestedAlternative,
      });
    }
  }

  // 3. 比较同类任务的不同方法
  const comparisons = await compareMethods(recentSuccesses, recentFailures);
  for (const comp of comparisons) {
    if (comp.improvement > 0.2) {
      reflection.insights.push(
        `${comp.winner} 比 ${comp.loser} 效率高 ${comp.improvement * 100}%`
      );

      await evoMap.adjustPriority(comp.winner, +0.1);
      await evoMap.adjustPriority(comp.loser, -0.1);
    }
  }

  // 4. 生成改进建议
  if (recentFailures.length > recentSuccesses.length) {
    reflection.recommendations.push(
      "最近失败率较高，建议：1. 检查环境配置 2. 降低任务复杂度 3. 请求用户反馈"
    );
  }

  // 5. 更新 Soul.md
  await soul.updateReflection(reflection);

  return reflection;
}
```

---

## 完整执行流程

```typescript
// 主循环
async function agentLoop(task: Task): Promise<Result> {
  // ========== 感知 ==========
  const perception = await perceive({
    task,
    environment: await getEnvironmentState(),
    userFeedback: await getUserFeedback(),
  });

  // ========== 记忆 ==========
  const recall = await recall({
    situation: perception.context.taskType,
    taskType: perception.context.taskType,
    constraints: perception.context.constraints,
  });

  // ========== 规划 ==========
  const plans = await generatePlans(perception, recall);
  const selectedPlan = plans[0];  // 选择置信度最高的

  // ========== 执行 ==========
  const result = await execute(selectedPlan);

  // ========== 结果处理 ==========
  if (result.status === 'success') {
    // ========== 强化 ==========
    await reinforce({
      plan: selectedPlan,
      result,
      context: perception,
    });

    return result.output;
  } else {
    // ========== 自我修复 ==========
    const repairResult = await repair({
      plan: selectedPlan,
      error: result.error,
      trace: result.trace,
      context: perception,
    });

    if (repairResult.status === 'repaired') {
      // ========== 修复后学习 ==========
      await reinforceRepair(repairResult);
      return repairResult.output;
    } else {
      // ========== 升级到用户 ==========
      return await requestUserHelp({
        task,
        attempted: [selectedPlan.description, ...repairResult.learned.attempted],
        error: result.error,
      });
    }
  }
}

// 定期反思（后台任务）
async function backgroundReflection() {
  setInterval(async () => {
    const reflection = await reflect();

    // 应用反思结果
    for (const update of reflection.skillUpdates) {
      if (update.type === 'create') {
        await memory.addSkill(update.skill);
        log.info(`创造新技能: ${update.skill.name}`);
      }
    }

    for (const insight of reflection.insights) {
      log.info(`洞察: ${insight}`);
      await soul.update(insight);
    }

    for (const antiPattern of reflection.antiPatterns) {
      log.warn(`反模式: ${antiPattern.pattern} - ${antiPattern.reason}`);
      await soul.updateAntiPattern(antiPattern);
    }
  }, 24 * 60 * 60 * 1000);  // 每天反思一次
}
```

---

## 数据流示意

```
用户输入 → 感知层 → 记忆层 → 规划层 → 执行层
                                    ↓
                              成功 ← → 失败
                               ↓        ↓
                           强化层    自我修复层
                               ↓        ↓
                               └──→ 反思层 ←──┘
                                    ↓
                              更新记忆/EvoMap/Soul
                                    ↓
                              下次任务更聪明
```

---

## 实现优先级

### P0 - 核心循环（MVP）
- [ ] 感知层：收集上下文
- [ ] 记忆层：基础检索
- [ ] 规划层：生成候选方案
- [ ] 执行层：执行并监控
- [ ] 基础强化：记录成功

### P1 - 自我修复
- [ ] 失败诊断
- [ ] 备选方案尝试
- [ ] 修复结果学习

### P2 - 智能进化
- [ ] 技能提取
- [ ] 技能优化
- [ ] EvoMap 更新

### P3 - 高级反思
- [ ] 定期反思
- [ ] 模式识别
- [ ] 原则提炼

---

## 相关文档

- [总览](./OVERVIEW.md) - 产品定位、核心原则
- [核心组件](./COMPONENTS.md) - Memory、Skill Creator、EvoMap、Soul.md
- [存储实现](./STORAGE.md) - Markdown 格式、索引机制
- [隔离策略](./ISOLATION.md) - 三区模型、环境变量
