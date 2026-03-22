# Constraints - 通用约束

> 适用于所有 Agent 和项目

---

## 绝对禁止

- ❌ 不读 `state.json` 就开始
- ❌ 不确认任务范围就实现
- ❌ 跳过 `/verify`
- ❌ 一次改超过 5 个文件
- ❌ 不更新 `state.json` 就结束
- ❌ 遇到阻塞不汇报
- ❌ 删除文件（除非明确授权）
- ❌ 提交 `console.log`、`debugger`、调试代码
- ❌ 提交敏感信息（API keys、passwords）

---

## 必须执行

### Session 开始
```
1. 读 harness/feedback/state/state.json
2. 读 harness/base/constraints.md
3. 读项目约束
```

### 任务开始
```
1. /start <任务>
2. 确认范围
3. 获得确认
```

### 执行中
```
1. 每步 /verify
2. 遇到阻塞 /blocked
3. 保持 state 更新
```

### 任务结束
```
1. /verify 通过
2. /review 自审
3. 人类 approve
4. /done
```

---

## 代码规范

| 规则 | 限制 |
|------|------|
| 函数长度 | < 50 行 |
| 文件长度 | < 300 行 |
| 圈复杂度 | < 10 |

---

## 工具集（少而精）

- ✅ Read / Write / Edit / Glob / Grep
- ✅ Bash（npm scripts、git）
- ❌ 不用网络请求（除非项目需要）
- ❌ 不用不熟悉的工具

---

## 日志规范

### 必须
- ✅ 结构化日志输出
- ✅ 关键操作记录
- ✅ 错误带上下文

### 禁止
- ❌ console.log 用于调试（用日志替代）
- ❌ 敏感信息日志
- ❌ 大量循环日志

### 日志格式
```typescript
// ✅ 推荐
logger.info('User login', { userId, timestamp });
logger.error('API failed', { url, status, error });

// ❌ 禁止
console.log('user logged in');
console.log('error:', error);
```

---

## 技术栈适配

### TypeScript/React
```
Gate 1: npm run lint       → eslint
Gate 2: npm run typecheck → tsc --noEmit
Gate 3: npm test           → vitest/jest
Gate 4: npm run build    → vite build
```

### Python
```
Gate 1: ruff check .   → 0 errors
Gate 2: mypy .         → 0 errors
Gate 3: pytest         → all pass
```

### Go
```
Gate 1: golangci-lint run → 0 errors
Gate 2: go test ./...   → all pass
```

---

## 违规处理

```
检测到违规 → 立即停止 → 修复 → 继续
```

多次违规 → 重读本文件
