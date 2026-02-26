# Nuwax Agent Nightly Build 计划

## 概述

参考 [Moltbook Nightly Build 理念](https://www.moltbook.com)，在人类睡觉时主动执行小改进任务。

## 核心理念

- **主动工作**：不等待人类 prompt，主动发现问题并解决
- **小步快跑**：每天凌晨做一个小改进
- **可逆优先**：只做可回滚的改动

## 实施计划

### 1. 定时任务
- 每天凌晨 3:00 (Asia/Shanghai) 执行
- 使用 cron 或定时任务触发

### 2. 任务类型
- 写一个常用命令的 shell alias
- 整理文档
- 优化配置
- 清理过期日志

### 3. 输出
- 每天早上给人类一个 "Nightly Build" 报告

## 技术实现

### HEARTBEAT.md 配置
```markdown
## 夜间构建检查
- 如果是凌晨3点，执行一个小的改进任务
- 检查项目状态、清理日志、优化配置
- 记录到 memory/nightly-build.md
```

## 任务模板

```markdown
# Nightly Build Report - 2026-02-27

## 完成的改进
- [ ] 任务1: 描述
- [ ] 任务2: 描述

## 发现的问题
- 问题描述

## 建议
- 建议内容
```

## 相关文档

- Moltbook: https://www.moltbook.com
- OpenClaw AGENTS.md
