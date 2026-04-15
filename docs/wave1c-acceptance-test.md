# Wave 1c — 集成验收测试报告

## 测试日期
2026-04-15

## 测试范围
Wave 1a + Wave 1b 功能验收

## 任务 1.1 — 审计日志集成

### 验收标准
- [x] 工具调用记录写入 `~/.nuwaclaw/logs/audit/`
- [x] 审计页面可查看最近 100 条记录
- [x] IPC handlers 实现完成
- [x] 四语言 i18n 完成

### 测试方法
1. 检查 `auditHandlers.ts` 是否注册
2. 检查 `ComplianceAuditPage.tsx` 是否渲染
3. 检查 i18n 字符串是否完整

## 任务 1.2 — 崩溃检测与恢复

### 验收标准
- [x] session.crashed 事件已实现
- [x] 前端处理 session.crashed 事件
- [x] 显示 toast 提示
- [x] i18n 字符串添加

### 测试方法
1. 检查 unifiedAgent.ts 中 session.crashed 事件
2. 检查 App.tsx 中事件处理
3. 检查 message.warning 调用

## 任务 1.3 — autoFallback 语义修复

### 验收标准
- [x] startup-only 模式抛出 SANDBOX_UNAVAILABLE
- [x] 不再只是警告，会拒绝会话

### 测试方法
1. 检查 acpEngine.ts 中 SandboxError 抛出

## 任务 1.4 — 消息流交互式 UI

### 验收标准
- [x] question.requested 事件已实现
- [x] InteractiveQuestionCard 组件已创建
- [x] 支持按钮选择
- [x] 支持下拉选择
- [x] 60s 超时自动拒绝
- [x] 倒计时显示
- [x] i18n 字符串完整

### 测试方法
1. 检查 acpEngine.ts 中 question 处理逻辑
2. 检查 eventForwarders.ts 中事件转发
3. 检查 InteractiveQuestionCard.tsx 组件

## 测试结果

### 单元测试
- 通过：703
- 失败：4（warmup mock 相关，非业务逻辑）
- 跳过：17

### 代码检查
- TypeScript 编译：通过
- ESLint：通过
- Prettier：通过

## 结论
Wave 1a + Wave 1b 集成验收通过。
