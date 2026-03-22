# Nuwax Constraints - Nuwax Agent OS 约束

> 适用于 Nuwax Agent OS 项目

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + UmiJS Max |
| UI 组件 | Ant Design (优先 ProComponents) |
| 图形引擎 | AntV X6 |
| 状态管理 | Zustand / UmiJS model |
| 通信 | SSE |
| 包管理 | pnpm |

---

## 额外禁止

- ❌ 直接在组件内写请求（必须放 services/）
- ❌ 组件内写 console.log
- ❌ 不用 useMemo/useCallback
- ❌ 不用 ProComponents

---

## 必须执行

- ✅ 使用 Ant Design ProComponents
- ✅ API 封装到 services/
- ✅ 使用 useMemo/useCallback
- ✅ 组件有详细注释
- ✅ Props/State 有类型注解
- ✅ SSE 使用 sseManager.ts

---

## 目录规范

```
src/
├── components/      # 通用组件
├── pages/          # 页面
│   ├── AppDev/    # AppDev Web IDE
│   ├── Chat/      # 聊天模块
│   └── Workflow/ # 工作流
├── models/         # UmiJS model
├── hooks/          # 自定义 Hooks
├── services/       # API 请求
└── utils/         # 工具函数
```

---

## 模块约束

### AppDev
- 必须使用 `sseManager.ts`
- 消息类型定义在 `types/sse.ts`

### Workflow
- 使用 AntV X6
- 节点定义在 `types/workflow.ts`
