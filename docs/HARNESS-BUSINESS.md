# Nuwax Harness 业务场景方案

> 基于 harness-monorepo + nuwaclaw 沙箱 + Anthropic/OpenAI 最佳实践  
> **版本**: 3.0.0  
> **更新**: 2026-03-23

---

## 1. 业务场景概述

### 1.1 核心场景

| 场景 | 说明 | 优先级 |
|------|------|--------|
| **沙箱创建** | 用户发起任务 → 创建隔离沙箱 | P0 |
| **任务执行** | Agent 在沙箱内执行代码任务 | P0 |
| **权限审批** | 危险操作需用户确认 | P0 |
| **任务追踪** | CP 工作流 + Checkpoint | P0 |
| **错误恢复** | 失败后自动/手动恢复 | P1 |
| **会话管理** | 多任务并行 / 会话持久化 | P1 |
| **审计日志** | 完整操作记录 | P1 |

### 1.2 典型业务流程

```
┌─────────────────────────────────────────────────────────────┐
│                     用户发起任务                              │
│  "帮我实现用户登录功能"                                       │
└─────────────────────────┬───────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                  CP0: 任务确认                               │
│  - 解析任务意图                                             │
│  - 检查权限                                                 │
│  - 分配 sandbox                                            │
└─────────────────────────┬───────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                  CP1: 任务规划                                │
│  - 分解子任务                                               │
│  - 风险评估                                                 │
│  - 资源预估                                                 │
└─────────────────────────┬───────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                  CP2: 沙箱执行                                │
│  - 创建沙箱                                                 │
│  - 执行代码                                                 │
│  - 权限检查                                                 │
└─────────────────────────┬───────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                  CP3: 质量验证                                │
│  - lint / typecheck                                        │
│  - 测试验证                                                 │
│  - 构建验证                                                 │
└─────────────────────────┬───────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                  CP4: 完成交付                                │
│  - 代码合并                                                 │
│  - 状态更新                                                 │
│  - 通知用户                                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 场景一：沙箱创建

### 2.1 用户流程

```
用户: "开始一个新任务"
    ↓
系统: 创建沙箱 + 分配 workspace
    ↓
Agent: 进入沙箱，开始工作
```

### 2.2 状态定义

```json
{
  "session": {
    "id": "sess_xxx",
    "userId": "user_xxx",
    "status": "creating",
    "sandbox": {
      "id": "sand_xxx",
      "type": "docker",
      "workspace": "/tmp/nuwaclaw/sess_xxx",
      "createdAt": "2026-03-23T00:00:00Z"
    },
    "agent": {
      "mode": "autonomous",
      "model": "claude-3-5"
    }
  }
}
```

### 2.3 Checkpoint 记录

```json
{
  "checkpoint": {
    "CP0_INIT": {
      "status": "completed",
      "timestamp": "2026-03-23T00:00:00Z",
      "duration": 1500,
      "sandboxId": "sand_xxx"
    }
  }
}
```

---

## 3. 场景二：任务执行

### 3.1 用户流程

```
用户: "帮我写一个登录页面"
    ↓
Agent: 规划 → 写代码 → 验证
    ↓
系统: 更新 checkpoint + 状态
    ↓
用户: 收到完成通知
```

### 3.2 任务结构

```json
{
  "task": {
    "id": "task_xxx",
    "sessionId": "sess_xxx",
    "description": "实现用户登录功能",
    "status": "in_progress",
    "currentStep": 2,
    "totalSteps": 5,
    
    "steps": [
      { "id": 1, "description": "创建登录组件", "status": "completed" },
      { "id": 2, "description": "实现 API 调用", "status": "in_progress" },
      { "id": 3, "description": "添加验证逻辑", "status": "pending" },
      { "id": 4, "description": "编写测试", "status": "pending" },
      { "id": 5, "description": "构建验证", "status": "pending" }
    ],
    
    "artifacts": [
      { "path": "src/login/index.tsx", "action": "created" },
      { "path": "src/api/auth.ts", "action": "modified" }
    ]
  }
}
```

### 3.3 执行日志

```json
{
  "execution": {
    "taskId": "task_xxx",
    "command": "pnpm install && pnpm run build",
    "cwd": "/tmp/nuwaclaw/sess_xxx/projects/login",
    "startedAt": "2026-03-23T00:01:00Z",
    "duration": 45000,
    "exitCode": 0,
    "stdout": "...",
    "stderr": ""
  }
}
```

---

## 4. 场景三：权限审批

### 4.1 触发条件

| 操作类型 | 触发条件 | 审批级别 |
|---------|-----------|---------|
| `file:delete` | 删除超过 5 个文件 | 高 |
| `command:execute` | `npm install` | 中 |
| `command:execute` | `git push` | 高 |
| `network:download` | 下载外部资源 | 中 |
| `package:install` | 安装包 | 低 |

### 4.2 审批请求

```json
{
  "approval": {
    "id": "apr_xxx",
    "taskId": "task_xxx",
    "type": "command:execute",
    "priority": "medium",
    
    "title": "执行 npm install",
    "description": "需要在项目中安装 lodash 依赖",
    
    "context": {
      "command": "npm install lodash",
      "cwd": "/tmp/nuwaclaw/sess_xxx/project",
      "package": "lodash@4.17.21",
      "riskLevel": "low"
    },
    
    "options": [
      { "label": "批准", "action": "approve" },
      { "label": "拒绝", "action": "deny" },
      { "label": "修改命令", "action": "modify", "prompt": "建议使用 pnpm" }
    ],
    
    "timeout": 60,
    "status": "pending",
    "createdAt": "2026-03-23T00:02:00Z"
  }
}
```

### 4.3 ACP 消息格式

```typescript
// 请求
interface ACPApprovalRequest {
  type: "approval_request";
  channel: "discord" | "telegram" | "app";
  approval: ApprovalRequest;
}

// 响应
interface ACPApprovalResponse {
  type: "approval_response";
  approvalId: string;
  decision: "approve" | "deny" | "modify";
  modifiedCommand?: string;
  reason?: string;
  respondedAt: string;
}
```

---

## 5. 场景四：任务追踪

### 5.1 状态机

```
pending → in_progress → completed
    ↓           ↓
    failed ←── ←──
    ↓
  recovering → in_progress (retry)
    ↓
   abandoned
```

### 5.2 状态持久化

```json
{
  "taskState": {
    "id": "task_xxx",
    "checkpoint": "CP2_EXEC",
    "checkpointStatus": "in_progress",
    
    "progress": {
      "currentStep": 2,
      "totalSteps": 5,
      "percentComplete": 40
    },
    
    "lastCheckpoint": {
      "type": "CP1_PLAN",
      "completedAt": "2026-03-23T00:01:00Z",
      "result": "Task breakdown completed"
    },
    
    "nextCheckpoint": {
      "type": "CP2_EXEC",
      "plannedAt": "2026-03-23T00:01:30Z",
      "estimatedDuration": 120000
    },
    
    "canResume": true,
    "resumeFrom": "CP1_PLAN"
  }
}
```

### 5.3 进度通知

```typescript
// ACP 消息
interface ACPProgressUpdate {
  type: "progress_update";
  taskId: string;
  checkpoint: string;
  percentComplete: number;
  message: string;  // "正在执行第 2/5 步..."
}
```

---

## 6. 场景五：错误恢复

### 6.1 错误分类

| 错误类型 | 例子 | 恢复策略 |
|---------|------|---------|
| **瞬时错误** | 网络超时、API 限流 | 自动重试 |
| **验证错误** | TypeScript 编译失败 | 暂停 + 通知 |
| **权限错误** | 权限被拒绝 | 人工审批 |
| **资源错误** | 内存不足、磁盘满 | 清理 + 重试 |
| **安全错误** | 路径遍历攻击 | 终止 + 审计 |

### 6.2 恢复流程

```
错误发生
    ↓
错误分类
    ↓
┌─────────────────────────────────────────┐
│  瞬时错误                                │
│  → 等待 → 重试 (最多3次)                │
│  → 成功 → 继续                          │
│  → 失败 → 升级                          │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  验证错误                                │
│  → 暂停任务                             │
│  → 通知用户                            │
│  → 等待修复                            │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  安全错误                               │
│  → 终止任务                            │
│  → 审计日志                            │
│  → 通知安全团队                        │
└─────────────────────────────────────────┘
```

### 6.3 恢复状态

```json
{
  "recovery": {
    "enabled": true,
    "attempt": 2,
    "maxAttempts": 3,
    
    "lastError": {
      "type": "transient",
      "code": "RATE_LIMIT",
      "message": "API rate limit exceeded",
      "occurredAt": "2026-03-23T00:03:00Z"
    },
    
    "nextRetry": {
      "scheduledAt": "2026-03-23T00:03:30Z",
      "countdown": 30
    },
    
    "history": [
      { "attempt": 1, "error": "timeout", "recovered": false },
      { "attempt": 2, "error": "rate_limit", "recovered": true }
    ]
  }
}
```

---

## 7. 场景六：会话管理

### 7.1 多任务并行

```json
{
  "session": {
    "id": "sess_xxx",
    "userId": "user_xxx",
    
    "tasks": {
      "active": ["task_1", "task_2"],
      "completed": ["task_0"],
      "failed": []
    },
    
    "limits": {
      "maxConcurrentTasks": 3,
      "maxTotalDuration": 3600000,
      "maxCost": 10.00
    },
    
    "usage": {
      "currentTasks": 2,
      "totalDuration": 1200000,
      "totalCost": 3.50
    }
  }
}
```

### 7.2 会话持久化

```json
{
  "sessionSnapshot": {
    "id": "sess_xxx",
    "createdAt": "2026-03-23T00:00:00Z",
    "lastActiveAt": "2026-03-23T00:05:00Z",
    
    "state": {
      "tasks": [...],
      "sandboxes": [...],
      "artifacts": [...],
      "checkpoints": [...]
    },
    
    "canResume": true,
    "expiresAt": "2026-03-24T00:00:00Z"
  }
}
```

---

## 8. 场景七：审计日志

### 8.1 日志结构

```json
{
  "auditLog": {
    "id": "audit_xxx",
    "timestamp": "2026-03-23T00:05:00Z",
    
    "event": {
      "type": "task.completed",
      "taskId": "task_xxx",
      "sessionId": "sess_xxx"
    },
    
    "actor": {
      "type": "agent",
      "id": "agent_xxx",
      "model": "claude-3-5"
    },
    
    "resource": {
      "type": "file",
      "path": "src/login/index.tsx",
      "action": "created"
    },
    
    "context": {
      "checkpoint": "CP4_COMPLETE",
      "duration": 300000,
      "cost": 0.50
    }
  }
}
```

### 8.2 安全事件

```json
{
  "securityEvent": {
    "id": "sec_xxx",
    "timestamp": "2026-03-23T00:05:00Z",
    
    "type": "command_blocked",
    "severity": "high",
    
    "description": "危险命令被拦截",
    
    "details": {
      "command": "rm -rf /",
      "reason": "Path traversal attempt",
      "sandboxId": "sand_xxx",
      "blocked": true
    },
    
    "action": {
      "taken": "blocked",
      "notified": ["user", "security_team"]
    }
  }
}
```

---

## 9. 实现优先级

### Phase 1: 核心沙箱 (本周)
- [ ] 沙箱创建/销毁
- [ ] 基本任务执行
- [ ] CP 工作流

### Phase 2: 权限审批 (下周)
- [ ] 权限触发机制
- [ ] ACP 审批消息
- [ ] 用户确认 UI

### Phase 3: 状态管理 (第3周)
- [ ] 任务状态持久化
- [ ] Checkpoint 记录
- [ ] 进度追踪

### Phase 4: 错误恢复 (第4周)
- [ ] 错误分类
- [ ] 自动恢复
- [ ] 人工介入

---

## 10. 参考

- [harness-monorepo](https://github.com/dongdada29/harness-monorepo)
- [Anthropic: Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [nuwaclaw sandbox](./sandbox/)

---

## 11. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-23 | 3.0.0 | 初始版本，基于业务场景 |
