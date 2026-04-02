# 沙箱方案实施计划（基于 Harness）

> **版本**: 1.0.0  
> **更新**: 2026-03-22  
> **状态**: 待开发

---

## 1. 项目概述

### 1.1 目标

为 Nuwax Agent Electron 客户端实现一个**多平台沙箱工作空间系统**，基于 Harness 架构：
- 安全隔离的 Agent 执行环境
- CP 工作流：CP1→CP2→CP3→CP4→CP5
- 多会话并行支持
- 跨平台（macOS / Windows / Linux）一致体验
- 可视化的权限管理和审计

### 1.2 Harness 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Harness 工作流                             │
│                                                              │
│   CP1 ──→ CP2 ──→ CP3 ──→ CP4 ──→ CP5                      │
│   任务     规划     执行     门禁     审查                   │
│   确认                                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    文件结构                                    │
│                                                              │
│   harness/                                                  │
│   ├── base/          # 基础约束和任务模板                     │
│   ├── input/         # 输入约束                              │
│   ├── feedback/      # 反馈机制                              │
│   ├── projects/      # 项目配置                              │
│   └── universal/     # 通用配置                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 目录结构

```
src/
├── main/
│   └── services/
│       └── sandbox/
│           ├── harness/
│           │   ├── base/
│           │   │   ├── constraints.md
│           │   │   └── tasks/
│           │   │       ├── sandbox-create.md
│           │   │       ├── sandbox-destroy.md
│           │   │       └── workspace-execute.md
│           │   ├── feedback/
│           │   │   ├── state.json
│           │   │   └── metrics.json
│           │   ├── projects/
│           │   │   ├── darwin/
│           │   │   ├── windows/
│           │   │   └── linux/
│           │   └── universal/
│           │       ├── commands.md
│           │       └── security.md
│           │
│           ├── SandboxManager.ts      # 抽象基类
│           ├── DockerSandbox.ts       # Docker 实现
│           ├── WslSandbox.ts         # WSL 实现
│           ├── FirejailSandbox.ts     # Firejail 实现
│           ├── WorkspaceManager.ts     # 工作区管理
│           ├── PermissionManager.ts   # 权限管理
│           └── index.ts               # 导出
│
├── renderer/
│   ├── components/
│   │   └── sandbox/
│   │       ├── HarnessWorkflow.tsx   # Harness 工作流可视化
│   │       ├── WorkspaceList.tsx      # 工作区列表
│   │       ├── QualityGates.tsx       # 门禁状态
│   │       └── PermissionDialog.tsx   # 权限审批弹窗
│   │
│   └── services/
│       └── sandbox/
│           └── sandboxService.ts
│
└── shared/
    ├── types/
    │   └── sandbox.ts
    ├── events/
    │   └── sandbox.ts
    └── errors/
        └── sandbox.ts
```

---

## 3. Harness 工作流

### 3.1 CP 阶段定义

```typescript
enum Checkpoint {
  CP1 = 'CP1', // 任务确认
  CP2 = 'CP2', // 规划分解
  CP3 = 'CP3', // 执行实现
  CP4 = 'CP4', // 质量门禁
  CP5 = 'CP5', // 审查完成
}

interface WorkflowState {
  currentCheckpoint: Checkpoint;
  checkpoints: Record<Checkpoint, CheckpointStatus>;
  gates: Record<string, GateStatus>;
  metrics: Metrics;
}
```

### 3.2 工作流执行器

```typescript
// src/main/services/sandbox/harness/SandboxWorkflow.ts

export class SandboxWorkflow {
  private state: WorkflowState;
  private harness: Harness;
  
  constructor(sessionId: string) {
    this.state = this.loadState(sessionId);
    this.harness = new Harness(this.state);
  }
  
  async run(task: SandboxTask): Promise<WorkflowResult> {
    // CP1: 任务确认
    const cp1Result = await this.cp1_validate(task);
    if (!cp1Result.valid) return { success: false, reason: cp1Result.reason };
    
    // CP2: 规划分解
    const plan = await this.cp2_plan(task);
    
    // CP3: 执行实现
    const execution = await this.cp3_execute(plan);
    
    // CP4: 质量门禁
    const gates = await this.cp4_gates(execution);
    if (!gates.allPassed) return { success: false, gates };
    
    // CP5: 审查完成
    const result = await this.cp5_finalize(execution);
    
    return { success: true, result };
  }
  
  private async cp1_validate(task: SandboxTask): Promise<CP1Result> {
    // 验证输入参数
    // 检查沙箱可用性
    // 更新 state.checkpoints.CP1
    return { valid: true };
  }
  
  private async cp2_plan(task: SandboxTask): Promise<ExecutionPlan> {
    // 分解任务
    // 分配资源
    // 更新 state.checkpoints.CP2
    return plan;
  }
  
  private async cp3_execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    // 执行计划
    // 记录日志
    // 更新 state.checkpoints.CP3
    return result;
  }
  
  private async cp4_gates(result: ExecutionResult): Promise<GateResult> {
    // 运行所有门禁检查
    // 更新 state.gates
    return gates;
  }
  
  private async cp5_finalize(result: ExecutionResult): Promise<FinalResult> {
    // 更新 metrics
    // 持久化 state
    // 更新 state.checkpoints.CP5
    return finalResult;
  }
}
```

---

## 4. 任务定义

### 4.1 沙箱创建任务

```typescript
// src/main/services/sandbox/harness/tasks/sandbox-create.ts

export const SANDBOX_CREATE_TASK = {
  name: 'sandbox-create',
  description: '创建沙箱工作区',
  
  input: {
    sessionId: { type: 'string', required: true },
    platform: { type: 'enum', values: ['darwin', 'win32', 'linux'], required: true },
    sandboxType: { type: 'enum', values: ['docker', 'wsl', 'firejail', 'none'], required: true },
    memoryLimit: { type: 'string', default: '2g' },
    diskQuota: { type: 'string', default: '10g' },
  },
  
  checkpoints: {
    CP1: {
      name: '任务确认',
      checks: [
        { type: 'required', field: 'sessionId' },
        { type: 'platform-match' },
        { type: 'sandbox-available' },
      ]
    },
    CP2: {
      name: '规划分解',
      checks: [
        { type: 'resource-allocate' },
        { type: 'path-resolve' },
      ]
    },
    CP3: {
      name: '执行实现',
      steps: [
        { action: 'create-directories' },
        { action: 'start-sandbox' },
        { action: 'inject-env' },
      ]
    },
    CP4: {
      name: '质量门禁',
      gates: ['config-validate', 'sandbox-create']
    },
    CP5: {
      name: '审查完成',
      actions: [
        { action: 'update-state' },
        { action: 'record-metrics' },
      ]
    }
  },
  
  constraints: [
    'memory-limit:1g-8g',
    'disk-quota:1g-100g',
    'no-system-modification',
  ],
};
```

### 4.2 命令执行任务

```typescript
// src/main/services/sandbox/harness/tasks/workspace-execute.ts

export const WORKSPACE_EXECUTE_TASK = {
  name: 'workspace-execute',
  description: '在沙箱中执行命令',
  
  input: {
    sessionId: { type: 'string', required: true },
    command: { type: 'string', required: true },
    args: { type: 'array', itemType: 'string', default: [] },
    cwd: { type: 'string', required: false },
    timeout: { type: 'number', default: 300000 },
  },
  
  checkpoints: {
    CP1: {
      name: '任务确认',
      checks: [
        { type: 'workspace-exists' },
        { type: 'command-not-empty' },
        { type: 'command-whitelisted' },
      ]
    },
    CP2: {
      name: '规划分解',
      checks: [
        { type: 'permission-check' },
        { type: 'timeout-set' },
      ]
    },
    CP3: {
      name: '执行实现',
      steps: [
        { action: 'request-permission', if: 'needs-confirmation' },
        { action: 'execute-command' },
        { action: 'capture-output' },
      ]
    },
    CP4: {
      name: '质量门禁',
      gates: ['execute']
    },
    CP5: {
      name: '审查完成',
      actions: [
        { action: 'record-metrics' },
        { action: 'update-state' },
      ]
    }
  },
  
  constraints: [
    'max-timeout:600000',
    'no-dangerous-commands',
    'workspace-only',
  ],
};
```

---

## 5. 质量门禁

### 5.1 Gate 定义

```typescript
// src/main/services/sandbox/harness/gates/index.ts

export const GATES = {
  'config-validate': {
    name: '配置验证',
    check: async (config: SandboxConfig): Promise<GateResult> => {
      const validPlatforms = ['darwin', 'win32', 'linux'];
      const validTypes = ['docker', 'wsl', 'firejail', 'none'];
      
      if (!validPlatforms.includes(config.platform)) {
        return { pass: false, reason: `Invalid platform: ${config.platform}` };
      }
      
      if (!validTypes.includes(config.type)) {
        return { pass: false, reason: `Invalid sandbox type: ${config.type}` };
      }
      
      return { pass: true };
    }
  },
  
  'sandbox-create': {
    name: '沙箱创建',
    check: async (workspace: Workspace): Promise<GateResult> => {
      // 检查目录存在
      // 检查容器运行中
      // 检查网络连接
      return { pass: true };
    }
  },
  
  'execute': {
    name: '命令执行',
    check: async (result: ExecuteResult): Promise<GateResult> => {
      if (result.timedOut) {
        return { pass: false, reason: 'Execution timed out' };
      }
      return { pass: result.exitCode === 0, reason: `Exit code: ${result.exitCode}` };
    }
  },
  
  'cleanup': {
    name: '清理验证',
    check: async (workspaceId: string): Promise<GateResult> => {
      // 检查目录已删除
      // 检查容器已停止
      return { pass: true };
    }
  },
};
```

### 5.2 Gate 执行器

```typescript
// src/main/services/sandbox/harness/gates/GateRunner.ts

export class GateRunner {
  async runGates(gateNames: string[], context: any): Promise<GateReport> {
    const results: Record<string, GateResult> = {};
    
    for (const gateName of gateNames) {
      const gate = GATES[gateName];
      if (!gate) {
        results[gateName] = { pass: false, reason: `Gate not found: ${gateName}` };
        continue;
      }
      
      try {
        results[gateName] = await gate.check(context);
      } catch (error) {
        results[gateName] = { pass: false, reason: `Gate error: ${error.message}` };
      }
    }
    
    const allPassed = Object.values(results).every(r => r.pass);
    
    return { results, allPassed };
  }
}
```

---

## 6. 开发阶段

### 阶段一：Harness 基础设施（2 天）

- [ ] 创建 harness 目录结构
- [ ] 创建 base/constraints.md
- [ ] 创建任务模板（sandbox-create.md, sandbox-destroy.md, workspace-execute.md）
- [ ] 创建 state.json 和 metrics.json
- [ ] 实现 WorkflowState 管理

### 阶段二：工作流引擎（2 天）

- [ ] 实现 SandboxWorkflow 类
- [ ] 实现 Checkpoint 转换逻辑
- [ ] 实现 GateRunner
- [ ] 实现 Metrics 收集

### 阶段三：沙箱实现（3 天）

- [ ] DockerSandbox 实现
- [ ] WslSandbox 实现（Windows）
- [ ] FirejailSandbox 实现（Linux）
- [ ] 跨平台路径处理

### 阶段四：权限管理（2 天）

- [ ] PermissionPolicy 定义
- [ ] PermissionManager 实现
- [ ] 用户确认流程
- [ ] 审计日志

### 阶段五：UI 集成（3 天）

- [ ] HarnessWorkflow 可视化组件
- [ ] QualityGates 状态显示
- [ ] PermissionDialog
- [ ] WorkspaceList

### 阶段六：测试与文档（2 天）

- [ ] 单元测试
- [ ] 集成测试
- [ ] 更新 README

---

## 7. 预计工期

| 阶段 | 内容 | 预计时间 |
|------|------|---------|
| 一 | Harness 基础设施 | 2 天 |
| 二 | 工作流引擎 | 2 天 |
| 三 | 沙箱实现 | 3 天 |
| 四 | 权限管理 | 2 天 |
| 五 | UI 集成 | 3 天 |
| 六 | 测试与文档 | 2 天 |
| **总计** | | **14 天** |

---

## 8. 相关文档

| 文档 | 说明 |
|------|------|
| [WORKSPACE-DESIGN.md](./WORKSPACE-DESIGN.md) | 基于 Harness 的设计 |
| [SANDBOX-API.md](./SANDBOX-API.md) | API 接口文档 |
| [README.md](./README.md) | 文档索引 |

---

## 9. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 1.0.0 | 初始版本，基于 Harness 架构 |
