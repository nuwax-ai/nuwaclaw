# 实施计划：干预 Dock 覆盖式透明遮罩（nuwax）

- 对应 spec：无独立 spec（用户口头需求 + 两轮方向澄清：范围=整个会话面板、视觉=透明遮罩）
- 状态：已完成（nuwax db0a8b034）
- 日期：2026-08-28

## 背景与目标

`.intervention-dock` 原为文档流内元素：审批/ask-question 出现时挤开会话布局（输入框被下推、禁用但可见，消息区被压缩）。改为覆盖式：dock 遮罩盖住整个会话面板（消息+输入框），背景透明（视觉透传）、拦截全部指针交互，卡片贴底浮层；决策后遮罩卸载、布局无跳动。

## 方案（纯 CSS，零 TSX 逻辑改动）

- `UnifiedChatSession/index.less`：`.intervention-dock` → `position:absolute; inset:0; z-index:30`，flex 贴底 + `padding-bottom` 避让输入框（消费 `--chat-input-height`），`> *` 限宽 800 居中，复用 `slide-in-up` 入场动画，不写 background；`--intervention-max-height` 放宽为 `calc(100cqh - 输入框高 - 2×marginXs)`
- ResizeObserver 保留（职责改为遮罩内避让），仅更新注释
- 保留：wholeDisabled（键盘侧守卫）、MessageQueuePanel 隐藏、`.only-input` display:none
- 死代码清理：LeftContent / PreviewAndDebug 两处 hash 永不匹配的 `.intervention-dock` 块

## 证明成立的测试

- `npm run test:conversation` **328/328 全绿**（含顺手修绿的 2 处过时断言）
- 手动验收待跑：dev 起 plan 会话触发审批卡——①卡片覆盖、底下可见 ②遮罩拦截点击/滚轮、决策后恢复无跳动 ③EditAgent 小容器 + 窄屏 ④暗色主题

## 偏离记录

1. 砍掉可选 aria（`role="dialog"`）：原与在途未提交改动同文件；后用户自己提交了在途工作（5e7570640），此项留作后续
2. 多提交一个文件 `tests/interventionDock.test.tsx`：用户提交 5e7570640（审批简化）改了组件签名但漏更新此测试，2 用例失败挡门，按「签名演进、用例没跟上」先例顺手修绿，已在提交信息注明
3. 在途隔离方案未用上：实施中途用户自己提交了在途 13 文件，工作区自然只剩本改造文件

## 后续项

- 遮罩 aria 语义（role/aria-modal + 焦点管理评估）
- E2E `verify:conversation` 合入前可选
