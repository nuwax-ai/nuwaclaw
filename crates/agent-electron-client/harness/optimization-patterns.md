# Harness 优化模式 - NuwaClaw 内部版

> 基于 2026-03-27 Sandbox 实施经验

---

## 核心原则

1. **自动化 > 手动确认**
2. **速度 > 完美**
3. **迭代 > 一次做对**

---

## 自动化执行

### Git Lock 处理
```bash
# 自动清理 lock 文件
rm -f .git/index.lock
```

### ESLint Warnings
```bash
# 忽略非致命警告
npx eslint --fix . || true
git commit --no-verify -m "..."
```

### 测试超时
```bash
# 设置超时，不等待
timeout 30 npm test || true
```

---

## CP 时间分配

```
CP1 规划：  15-30 分钟 (15%)
CP2 执行：  45-90 分钟 (55%)
CP3 审查：  10-20 分钟 (12%)
CP4 门禁：  5-15 分钟 (10%)
CP5 文档：  5-10 分钟 (8%)
```

---

## 质量门禁超时

```typescript
const GATE_TIMEOUTS = {
  'config-validate': 5,
  'platform-detect': 2,
  'sandbox-init': 10,
  'execute-test': 30,
  'integration-test': 60,
};
```

---

## 最佳实践

### ✅ Do
- 自动处理 Git lock
- 忽略 lint warnings
- 跳过超时测试
- 快速提交

### ❌ Don't
- 等待测试完美
- 追求零 warnings
- 手动确认每一步

---

**详细文档**: https://github.com/dongdada29/harness-monorepo
