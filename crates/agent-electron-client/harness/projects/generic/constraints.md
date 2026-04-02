# Generic Constraints - 通用项目约束

> 适用于任何项目

---

## 使用方式

本约束配合 `harness/base/constraints.md` 使用。

---

## 快速配置

根据你的项目类型选择技术栈：

### TypeScript/React
```bash
Gate 1: npm run lint       → eslint
Gate 2: npm run typecheck → tsc --noEmit
Gate 3: npm test           → vitest
Gate 4: npm run build     → vite build
```

### Python
```bash
Gate 1: ruff check .   → 0 errors
Gate 2: mypy .         → 0 errors
Gate 3: pytest         → all pass
```

### Go
```bash
Gate 1: golangci-lint run → 0 errors
Gate 2: go test ./...   → all pass
```

---

## 项目初始化

```bash
# 创建项目约束配置
echo '{"project": "你的项目", "type": "generic"}' > harness/feedback/state/state.json
```
