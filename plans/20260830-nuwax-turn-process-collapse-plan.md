# 实施计划：nuwax-turn-process-collapse

- 对应 spec：`specs/nuwax-turn-process-collapse.md`
- 状态：已接受（用户，2026-08-30）

## 改动文件清单

| # | 文件 | 动作 | 说明 |
|---|---|---|---|
| 1 | `nuwax/src/components/business-component/UnifiedChatSession/components/ChatContentArea/` | 改 | 默认消息列表按轮次投影与渲染 |
| 2 | `nuwax/src/components/ChatView/`、`nuwax/src/components/MarkdownCustomProcessGroup/` | 增/改 | 轮次过程 disclosure、最终 summary 与无障碍交互 |
| 3 | `nuwax/src/components/MarkdownRenderer/`、会话工具函数 | 改 | 过程归一化、标签编码修复和统计模型 |
| 4 | `nuwax/src/locales/i18n/` | 改 | 五语言文案 |
| 5 | `nuwax/mock/`、`nuwax/scripts/e2e/`、相关测试 | 改 | 单测与真实页面验收 |
| 6 | `nuwax/docs/conversation/` | 改 | 行为、验收和已实现矩阵 |

## 实施顺序

1. 建立失败测试，锁定轮次归组、summary 分离、统计与现有标签编码缺陷。
2. 实现纯轮次投影与统计，不改后端/IPC 数据形状。
3. 在默认普通会话渲染路径接入轮次展示，保留自定义 renderer 与 pending 交互路径。
4. 实现 disclosure header、三档 density、稳定本地展开态和键盘/ARIA。
5. 接入最终 summary Markdown、操作栏与边界状态。
6. 补齐 locale、Mock 场景、E2E 与会话文档。
7. 构建 nuwax dist，完成子模块提交；父仓只提交本计划链与 gitlink pin bump。

## 证明成立的测试

- 新增测试：轮次 projector、过程指标、summary fallback、disclosure 交互及 ChatContentArea 接线。
- 定向回归：MarkdownRenderer utils、ChatView、ChatContentArea。
- 会话回归：`npm run test:conversation`。
- 页面验收：`npm run e2e:mock-chat`，重点 `TERMINAL_COLLAPSE` / `COLLAPSE_SHOWCASE`。
- 构建：`pnpm run build:prod`；父仓 `npm run test:electron`。
- 基线说明：实施前 ChatView 8/8 通过；MarkdownRenderer 51 条有 3 个既存失败，其中过程标签编码 1 个在本期修复，2 个 LaTeX 换行问题不扩大范围。

## 风险与回退

| 风险 | 缓解 | 回退方式 |
|---|---|---|
| 跨消息归组错误 | requestId 优先、USER 边界回退、纯函数矩阵测试 | 回退 ChatContentArea 轮次 projector 接线 |
| 流式更新导致展开态闪烁 | 稳定 turn key + 本地状态不随 children 重建 | 回退到既有单消息过程组 |
| pending 交互被隐藏 | pending 卡明确排除在过程区外并加组件测试 | 关闭该轮聚合，保留现有卡片路径 |
| 历史分页滚动跳动 | 维持消息锚点并测试半轮 prepend | 对未完整轮次暂用旧渲染 |
| 现有脏改动误提交 | 禁止 `git add -A`，逐路径暂存并审查 staged diff | 取消暂存，不 reset 用户工作 |

## 偏离记录

- 暂无。实现如需改变轮次边界、计数口径或 summary 来源，必须先更新本文件与 spec。
