# Nuwax Agent OS - 项目配置

> 适用于 Nuwax Agent OS 的完整开发配置

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

## 目录结构

```
src/
├── components/      # 通用组件
├── pages/          # 页面
│   ├── AppDev/    # Web IDE
│   ├── Chat/      # 聊天
│   └── Workflow/  # 工作流
├── models/         # UmiJS model
├── hooks/          # 自定义 Hooks
├── services/       # API 请求
└── utils/         # 工具函数
```

---

## 模块

| 模块 | 说明 |
|------|------|
| AppDev | Web IDE 开发环境 |
| Chat | AI 聊天对话 |
| Workflow | 工作流编排 |

---

## 文档

- `nuwax.md` - 项目规范
- `modules.md` - 模块开发规范
- `workflow-guide.md` - 工作流指南

---

## 使用

```bash
# 接入项目
rsync -av nuwax/ /path/to/nuwax/
```
