# Constraints - 约束规则

## 绝对禁止

- ❌ 不读 state.json 就开始写代码
- ❌ 不确认任务范围就自行实现
- ❌ 跳过 /verify 直接说"完成"
- ❌ 一次改超过 5 个文件
- ❌ 不更新 state 就结束 session
- ❌ 遇到阻塞不汇报继续硬做
- ❌ 删除文件（除非人类明确授权）
- ❌ 提交包含 console.log 或调试代码
- ❌ 提交包含敏感信息（API keys、passwords）
- ❌ commit message 写 "WIP"、"fixed stuff"

## 必须执行

### 开始时
- ✅ 先读 harness/feedback/state/state.json
- ✅ 确认任务范围
- ✅ 用 /start 开始

### 执行时
- ✅ 每步验证
- ✅ 用 /verify 检查
- ✅ 阻塞立刻用 /blocked 报告

### 结束时
- ✅ 更新 state.json
- ✅ 添加到 history
- ✅ 用 /done 标记完成

## 架构约束

### 分层架构（如果项目有）
```
Types → Config → Repo → Service → UI
```
- 只能向下层依赖
- 不能跨层依赖
- 同层可互相引用

### 代码规范
- 函数长度 < 50 行
- 文件长度 < 300 行
- 无重复代码块
- 命名语义化

## 违规处理

检测到违规 → 停止执行 → 修复 → 再继续

多次违规 → 重新读本文件
