# Harness 方案升级计划

> **基于 Anthropic & OpenAI Harness Engineering 最佳实践**  
> **版本**: 2.0.0  
> **更新**: 2026-03-23

---

## 1. 当前方案评估

### 1.1 现有架构 ✅

```
WorkspaceManager → SandboxManager → DockerSandbox
                      ↓
              PermissionManager
                      ↓
              用户确认 + 审计
```

### 1.2 CP 工作流 ✅

```
CP1: 任务确认 → CP2: 规划分解 → CP3: 执行实现 → CP4: 质量门禁 → CP5: 审查完成
```

### 1.3 缺失的功能

| 功能 | 当前状态 | 建议优先级 |
|------|---------|-----------|
| 任务验证点 (Checkpoints) | ✅ 有 | - |
| 进度持久化 | ⚠️ 简单 | 高 |
| 错误恢复 | ❌ 缺失 | 高 |
| Human-in-the-loop | ❌ 缺失 | 高 |
| 多步骤任务 | ❌ 缺失 | 高 |
| 可观测性 | ⚠️ 简单 | 中 |

---

## 2. 核心升级：Checkpoint System

### 2.1 什么是 Checkpoint

Checkpoint = **任务执行的关键节点**，用于：
- 记录进度
- 支持恢复
- 验证状态
- 人工审批

### 2.2 Checkpoint 类型

```typescript
enum CheckpointType {
  // 任务阶段
  TASK_START = 'task_start',
  TASK_PLAN = 'task_plan',
  TASK_EXEC = 'task_exec',
  TASK_REVIEW = 'task_review',
  TASK_COMPLETE = 'task_complete',
  
  // 安全阶段
  SECURITY_SCAN = 'security_scan',
  PERMISSION_CHECK = 'permission_check',
  USER_APPROVAL = 'user_approval',
  
  // 质量阶段
  QUALITY_GATE = 'quality_gate',
  TEST_PASS = 'test_pass',
  BUILD_PASS = 'build_pass',
}
```

### 2.3 Checkpoint 状态

```typescript
interface Checkpoint {
  id: string;
  type: CheckpointType;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  timestamp: string;
  duration?: number;        // 耗时
  input?: any;              // 输入数据
  output?: any;              // 输出数据
  error?: string;           // 错误信息
  approvedBy?: 'system' | 'user';
  metadata?: Record<string, any>;
}
```

---

## 3. 升级：任务持久化

### 3.1 Task State

```typescript
interface TaskState {
  id: string;
  sessionId: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  
  // Checkpoint 进度
  checkpoints: Checkpoint[];
  currentCheckpoint: string;
  
  // 上下文
  context: {
    taskHistory: string[];      // 历史任务
    completedSteps: string[];   // 已完成步骤
    pendingSteps: string[];      // 待完成步骤
    blockedReason?: string;     // 阻塞原因
  };
  
  // 资源
  resources: {
    workspacePath?: string;
    containerId?: string;
    startTime?: string;
    lastActive?: string;
  };
  
  // 元数据
  createdAt: string;
  updatedAt: string;
}
```

### 3.2 持久化存储

```typescript
// TaskStore.ts
class TaskStore {
  private storePath: string;
  
  async save(task: TaskState): Promise<void>;
  async load(taskId: string): Promise<TaskState | null>;
  async list(sessionId?: string): Promise<TaskState[]>;
  async delete(taskId: string): Promise<void>;
  
  // 快照（用于恢复）
  async snapshot(taskId: string): Promise<Snapshot>;
  async restore(snapshotId: string): Promise<TaskState>;
}
```

---

## 4. 升级：错误恢复

### 4.1 错误分类

```typescript
enum ErrorType {
  // 可恢复
  TRANSIENT = 'transient',        // 临时错误（网络、超时）
  RATE_LIMIT = 'rate_limit',       // 限流
  RESOURCE_BUSY = 'resource_busy', // 资源忙
  
  // 需人工处理
  PERMISSION_DENIED = 'permission_denied',
  VALIDATION_ERROR = 'validation_error',
  SECURITY_VIOLATION = 'security_violation',
  
  // 不可恢复
  FATAL = 'fatal',               // 致命错误
  UNSUPPORTED = 'unsupported',    // 不支持
}
```

### 4.2 恢复策略

```typescript
interface RecoveryStrategy {
  errorType: ErrorType;
  action: 'retry' | 'wait' | 'skip' | 'pause' | 'abort' | 'escalate';
  maxRetries?: number;
  retryDelay?: number;           // 秒
  fallback?: string;             // 备用方案
}

const DEFAULT_RECOVERY_STRATEGIES: RecoveryStrategy[] = [
  { errorType: ErrorType.TRANSIENT, action: 'retry', maxRetries: 3, retryDelay: 5 },
  { errorType: ErrorType.RATE_LIMIT, action: 'wait', retryDelay: 30 },
  { errorType: ErrorType.PERMISSION_DENIED, action: 'escalate' },
  { errorType: ErrorType.SECURITY_VIOLATION, action: 'abort' },
];
```

### 4.3 错误恢复流程

```
错误发生
    ↓
识别错误类型
    ↓
查找恢复策略
    ↓
┌─────────────────────────────────────────┐
│                                         │
│  retry → 重试 → 检查点 → 继续           │
│  wait  → 等待 → 定时器 → 检查点 → 继续  │
│  skip  → 跳过 → 记录 → 继续             │
│  pause → 暂停 → 等待 → 用户 → 决定      │
│  abort → 终止 → 记录 → 报告            │
└─────────────────────────────────────────┘
```

---

## 5. 升级：Human-in-the-Loop

### 5.1 需要人工介入的场景

```typescript
const HUMAN_IN_LOOP_TRIGGERS = [
  // 安全相关
  { type: 'security_violation', priority: 'high' },
  { type: 'permission_denied', priority: 'high' },
  { type: 'suspicious_command', priority: 'high' },
  
  // 决策相关
  { type: 'ambiguous_task', priority: 'medium' },
  { type: 'multiple_options', priority: 'medium' },
  { type: 'task_blocked', priority: 'medium' },
  
  // 审批相关
  { type: 'destructive_action', priority: 'high' },
  { type: 'external_network_call', priority: 'low' },
  { type: 'significant_change', priority: 'low' },
];
```

### 5.2 审批请求格式

```typescript
interface ApprovalRequest {
  id: string;
  taskId: string;
  checkpointId: string;
  
  type: 'security' | 'decision' | 'destructive' | 'approval';
  priority: 'low' | 'medium' | 'high' | 'critical';
  
  title: string;
  description: string;
  
  options?: string[];              // 可选方案
  recommendedOption?: string;       // 推荐方案
  
  context: {
    command?: string;
    filePath?: string;
    changes?: string[];
    riskAssessment?: string;
  };
  
  timeout?: number;               // 超时时间（秒）
  deadline?: string;                // 截止时间
  
  createdAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}
```

### 5.3 ACP 审批消息

```typescript
// ACP 消息格式
interface ACPApprovalMessage {
  type: 'approval_request';
  request: ApprovalRequest;
}

// 用户响应
interface ACPApprovalResponse {
  type: 'approval_response';
  requestId: string;
  decision: 'approve' | 'deny' | 'skip' | 'delegate';
  selectedOption?: string;
  reason?: string;
}
```

---

## 6. 升级：多步骤任务

### 6.1 任务分解

```typescript
interface TaskDecomposition {
  originalTask: string;
  steps: TaskStep[];
  estimatedDuration?: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface TaskStep {
  id: string;
  description: string;
  type: 'read' | 'write' | 'execute' | 'review' | 'approve';
  
  // 依赖
  dependsOn: string[];           // 依赖的前置步骤
  blockingSteps: string[];         // 阻塞的后置步骤
  
  // Checkpoint
  checkpoint: CheckpointType;
  
  // 权限
  requiredPermissions: PermissionType[];
  
  // 风险
  riskLevel: 'low' | 'medium' | 'high';
  riskDescription?: string;
}
```

### 6.2 步骤执行器

```typescript
class StepExecutor {
  async executeStep(
    step: TaskStep,
    context: ExecutionContext
  ): Promise<StepResult> {
    
    // 1. 检查依赖是否完成
    await this.checkDependencies(step);
    
    // 2. 获取所需权限
    await this.acquirePermissions(step);
    
    // 3. 创建 Checkpoint
    const checkpoint = await this.createCheckpoint(step);
    
    // 4. 执行
    const result = await this.run(step);
    
    // 5. 验证结果
    await this.validateResult(result);
    
    // 6. 更新状态
    await this.updateProgress(step, result);
    
    return result;
  }
}
```

---

## 7. 升级：可观测性

### 7.1 指标收集

```typescript
interface HarnessMetrics {
  // 任务指标
  tasks: {
    total: number;
    completed: number;
    failed: number;
    paused: number;
    averageDuration: number;
  };
  
  // Checkpoint 指标
  checkpoints: {
    total: number;
    passed: number;
    failed: number;
    averageDuration: number;
    byType: Record<CheckpointType, number>;
  };
  
  // 恢复指标
  recovery: {
    attempts: number;
    successes: number;
    failures: number;
    byErrorType: Record<ErrorType, number>;
  };
  
  // Human-in-the-loop 指标
  humanLoop: {
    requests: number;
    approvals: number;
    denials: number;
    averageResponseTime: number;
  };
}
```

### 7.2 事件追踪

```typescript
interface HarnessEvent {
  id: string;
  timestamp: string;
  type: EventType;
  taskId?: string;
  checkpointId?: string;
  sessionId: string;
  
  data: Record<string, any>;
  
  // 溯源
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

enum EventType {
  TASK_CREATED = 'task_created',
  TASK_STARTED = 'task_started',
  TASK_COMPLETED = 'task_completed',
  TASK_FAILED = 'task_failed',
  CHECKPOINT_ENTERED = 'checkpoint_entered',
  CHECKPOINT_PASSED = 'checkpoint_passed',
  CHECKPOINT_FAILED = 'checkpoint_failed',
  RECOVERY_ATTEMPTED = 'recovery_attempted',
  RECOVERY_SUCCEEDED = 'recovery_succeeded',
  HUMAN_APPROVAL_REQUESTED = 'human_approval_requested',
  HUMAN_APPROVAL_RECEIVED = 'human_approval_received',
}
```

### 7.3 健康检查

```typescript
interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    taskStore: ComponentHealth;
    sandboxManager: ComponentHealth;
    permissionManager: ComponentHealth;
    auditLogger: ComponentHealth;
  };
  metrics: HarnessMetrics;
  alerts: Alert[];
}

interface Alert {
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: string;
  resolved?: boolean;
}
```

---

## 8. 升级路线图

### Phase 1: 核心增强（1-2 周）

- [ ] 实现 Checkpoint 系统
- [ ] 添加任务持久化
- [ ] 完善错误恢复机制

### Phase 2: Human-in-the-Loop（1 周）

- [ ] 设计审批请求格式
- [ ] 实现 ACP 审批消息
- [ ] 开发审批 UI 组件

### Phase 3: 多步骤任务（2 周）

- [ ] 实现任务分解
- [ ] 开发步骤执行器
- [ ] 添加依赖管理

### Phase 4: 可观测性（1 周）

- [ ] 实现指标收集
- [ ] 添加事件追踪
- [ ] 开发健康检查

---

## 9. 参考资料

由于无法访问原始链接，基于行业最佳实践：

### Anthropic Harness Engineering 核心原则
1. **任务分解** - 大任务拆分为小步骤
2. **Checkpoint** - 每个关键节点验证
3. **错误恢复** - 自动恢复 + 人工介入
4. **可观测性** - 全链路追踪

### OpenAI Harness Engineering 核心原则
1. **安全优先** - 多层防护
2. **用户可控** - Human-in-the-loop
3. **渐进式** - 从简单开始
4. **可审计** - 完整日志

---

## 10. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-23 | 2.0.0 | 初始版本，基于行业最佳实践 |
