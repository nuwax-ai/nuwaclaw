# Logging Standards - 日志规范

> Agent 输出日志的标准格式

---

## 为什么重要

没有日志，Agent 无法自我纠错。
没有结构化日志，人类无法理解 Agent 的行为。

---

## 日志级别

| 级别 | 使用场景 | 示例 |
|------|----------|------|
| **ERROR** | 操作失败、需要人工介入 | `logger.error('API failed', { url, status })` |
| **WARN** | 潜在问题、不确定的操作 | `logger.warn('Retrying...', { attempt })` |
| **INFO** | 关键操作完成 | `logger.info('File saved', { path })` |
| **DEBUG** | 调试信息（生产关闭） | `logger.debug('Response:', response)` |

---

## 日志格式

### 结构化日志（推荐）

```typescript
// ✅ 推荐格式
logger.info('User login', {
  userId: '123',
  timestamp: new Date().toISOString(),
  duration: 150, // ms
});

// ✅ 错误日志
logger.error('API request failed', {
  url: '/api/users',
  status: 500,
  error: error.message,
  retry: attempt <= 3,
});
```

### 旧格式（避免）

```typescript
// ❌ 不要这样
console.log('user logged in');
console.log('error: ' + error);
console.warn('retrying...');
```

---

## Agent 日志规范

### 任务开始
```
logger.info('Task started', {
  task: '用户注册功能',
  taskId: 'task-001',
  agent: 'claude-code',
});
```

### 任务完成
```
logger.info('Task completed', {
  task: '用户注册功能',
  taskId: 'task-001',
  duration: 1200000, // ms
  filesChanged: ['src/user.ts', 'tests/user.test.ts'],
});
```

### 任务失败
```
logger.error('Task failed', {
  task: '用户注册功能',
  taskId: 'task-001',
  error: 'TypeError: Cannot read property',
  stage: 'CP3',
});
```

---

## 可观测信号

### 必须有日志的场景

1. **外部 API 调用**
2. **文件操作（读/写/删）**
3. **数据库操作**
4. **关键业务逻辑**
5. **错误和异常**

### 日志应该包含

- 操作名称
- 操作对象（ID、路径等）
- 时间戳
- 结果（成功/失败）
- 性能数据（耗时）

---

## Python 日志

```python
import logging

logger = logging.getLogger(__name__)

# ✅ 推荐
logger.info('User login', extra={
    'user_id': '123',
    'duration': 150,
})

# ❌ 避免
print('user logged in')
```

---

## Shell 脚本日志

```bash
# ✅ 推荐
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

log "INFO: Starting build"
log "ERROR: Build failed"

# ❌ 避免
echo "building..."
echo "done"
```

---

## 违规处理

```
发现 console.log → 替换为 logger.info
发现 console.warn → 替换为 logger.warn
发现无日志的关键操作 → 添加日志
```

---

## 工具建议

| 语言 | 日志库 |
|------|--------|
| TypeScript | pino, winston |
| Python | structlog |
| Go | slog |
| Rust | tracing |
| Shell | 自定义 log 函数 |
