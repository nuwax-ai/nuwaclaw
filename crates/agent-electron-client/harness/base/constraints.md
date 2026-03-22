# Nuwax Harness 约束配置

> 版本: 3.0.0  
> 基于: Anthropic Effective Harnesses + OpenAI Harness Engineering  
> 更新: 2026-03-23

---

## 1. Agent 概述

### 1.1 什么是 Harness？

```
┌─────────────────────────────────────────────────────────────┐
│                     Harness 架构                           │
│                                                              │
│   Agent = 思考/决策                                         │
│   Harness = 执行环境 + 安全网                                │
│                                                              │
│   Agent ──→ Harness ──→ 工具 ──→ 结果                       │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Agent 能力

| 能力 | 说明 |
|------|------|
| `code` | 代码生成和修改 |
| `file` | 文件操作 |
| `terminal` | 命令执行 |
| `mcp` | MCP 工具调用 |

### 1.3 Agent 模式

```json
{
  "mode": "autonomous",
  "humanLoop": "available"
}
```

---

## 2. Checkpoint 系统

### 2.1 Checkpoint 类型

| Checkpoint | 说明 | 必须通过 |
|------------|------|----------|
| `CP0_INIT` | 初始化 | ✅ |
| `CP1_PLAN` | 任务规划 | ✅ |
| `CP2_EXEC` | 执行 | ✅ |
| `CP3_VERIFY` | 验证 | ✅ |
| `CP4_COMPLETE` | 完成 | ✅ |

### 2.2 Checkpoint 状态

```typescript
enum CheckpointStatus {
  pending = "pending",
  in_progress = "in_progress",
  completed = "completed",
  failed = "failed",
  skipped = "skipped"
}
```

### 2.3 Checkpoint 规则

- 每个 Checkpoint 必须记录 timestamp 和 duration
- failed Checkpoint 必须记录 error 信息
- 连续 3 次 Checkpoint 失败触发人工介入

---

## 3. 内存管理

### 3.1 上下文结构

```json
{
  "taskHistory": [],
  "completedSteps": [],
  "pendingSteps": [],
  "blockedReason": null
}
```

### 3.2 内存保留策略

| 类型 | 保留时间 | 说明 |
|------|----------|------|
| 任务历史 | 7 天 | 最近 100 条 |
| 检查点 | 永久 | 审计用 |
| 模式学习 | 30 天 | patterns |
| 敏感数据 | 0 | 立即删除 |

---

## 4. 安全机制

### 4.1 故障分类

| 类型 | 说明 | 示例 |
|------|------|------|
| **Mistake** | Agent 决策错误 | 错误的修复方案 |
| **Misfire** | 工具调用问题 | API 超时、无权限 |
| **Crash** | 系统崩溃 | OOM、进程终止 |

### 4.2 安全模式

```json
{
  "mode": "enforced",
  "sandbox": {
    "enabled": true,
    "type": "docker",
    "isolation": "strict"
  }
}
```

### 4.3 路径白名单

#### 允许路径 ✅
```
~/workspace/**      # 开发工作区
~/projects/**      # 项目目录
~/dev/**          # 开发目录
/tmp/nuwaclaw/**  # 临时沙箱
```

#### 禁止路径 ❌
```
~/.ssh/**          # SSH 密钥
~/.config/**       # 用户配置
~/.aws/**         # AWS 凭据
/etc/**           # 系统配置（除非明确允许）
~/Library/**      # macOS 应用数据
/Volumes/**       # 外接存储
```

### 4.4 命令分类

#### 自动批准 ✅
```
# Git 只读
git status, git diff, git log, git show

# 文件查看
cat, head, tail, grep, find, ls, tree

# 工具版本
node --version, npm --version, pnpm --version
```

#### 需要确认 ⚠️
```
# 文件操作
rm, mv, cp, mkdir, chmod

# 包安装
npm install, pnpm add, pip install

# 下载
curl, wget, git clone
```

#### 绝对禁止 ❌
```
sudo, su, chmod 777
apt-get install, yum install
nmap, masscan, netcat
```

### 4.5 沙箱内完全信任 ✅
```
# 沙箱内允许所有操作（包括 rm -rf）
# 因为沙箱是隔离环境
```

---

## 5. 限制策略

### 5.1 资源限制

```json
{
  "maxTokensPerTask": 100000,
  "maxExecutionTime": 600000,
  "maxFileChanges": 100,
  "maxNetworkCalls": 50
}
```

### 5.2 成本管理

```json
{
  "tokenBudget": 1000000,
  "costLimit": 10.00
}
```

### 5.3 速率限制

```json
{
  "requestsPerMinute": 60,
  "concurrentTasks": 3
}
```

---

## 6. 错误恢复

### 6.1 恢复策略

```typescript
const RECOVERY_STRATEGIES = {
  // 临时错误：重试
  transient: { action: "retry", maxAttempts: 3, delay: 5000 },
  
  // 限流：等待
  rateLimit: { action: "wait", delay: 30000 },
  
  // 权限拒绝：上报
  permissionDenied: { action: "escalate", notifyUser: true },
  
  // 安全违规：停止
  securityViolation: { action: "abort", logAndStop: true }
};
```

### 6.2 检查点间隔

```
checkpointInterval: 300000 (5 分钟)
```

---

## 7. Human-in-the-Loop

### 7.1 触发条件

| 条件 | 优先级 | 说明 |
|------|--------|------|
| 安全违规 | critical | 立即停止 |
| 权限拒绝 | high | 用户审批 |
| 任务阻塞 | medium | 寻求帮助 |
| 成本超限 | high | 用户确认 |

### 7.2 审批请求格式

```json
{
  "type": "approval_request",
  "title": "执行危险操作",
  "description": "请求执行 rm -rf node_modules",
  "options": ["批准", "拒绝", "修改命令"]
}
```

---

## 8. 工作空间

### 8.1 隔离策略

```
沙箱外 = workspaceOnly = 严格限制
沙箱内 = 完全信任 = 包括 rm -rf
```

### 8.2 保留策略

```json
{
  "mode": "timeout",
  "maxAge": 604800000,
  "maxWorkspaces": 10,
  "maxSize": "50g"
}
```

---

## 9. 指标收集

### 9.1 必须追踪的指标

| 指标 | 说明 |
|------|------|
| `tasks.total/completed/failed` | 任务统计 |
| `checkpoints.passed/failed/skipped` | 检查点统计 |
| `recovery.attempts/successes/failures` | 恢复统计 |
| `humanLoop.requests/approvals/denials` | 人工介入统计 |

### 9.2 健康检查

每 60 秒检查一次：
- 检查点通过率 > 95%
- 恢复成功率 > 80%
- 人工介入率 < 10%

---

## 10. CP 工作流

```
CP0_INIT ──→ CP1_PLAN ──→ CP2_EXEC ──→ CP3_VERIFY ──→ CP4_COMPLETE
   ↓           ↓            ↓            ↓             ↓
 初始化      规划        执行        验证         完成
```

### 每个阶段的要求

| 阶段 | 必须记录 | 超时 |
|------|----------|------|
| CP0 | timestamp | 10s |
| CP1 | task breakdown | 60s |
| CP2 | command + output | 300s |
| CP3 | verification result | 60s |
| CP4 | final summary | 30s |

---

## 11. 参考资料

- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [OpenAI: Harness Engineering](https://openai.com/index/harness-engineering/)

---

## 12. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-23 | 3.0.0 | 基于 Anthropic/OpenAI 重构 |
| 2026-03-22 | 2.1.0 | 沙箱内 rm -rf 允许 |
| 2026-03-22 | 2.0.0 | 全面重构，增加路径白名单 |
| 2026-03-22 | 1.0.0 | 初始版本 |
