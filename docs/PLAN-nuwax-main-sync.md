# Nuwax Main 同步迁移方案

> 基于 `workspace/nuwax` `main` 分支 `aa297a78`（2026-06-12）与 `agent-workbench` 当前实现对比
> 基线对比点：nuwax 旧 HEAD `ad6ddfe7` → 新 main `aa297a78`（147 commits）

---

## 变更总览

| 类别 | 影响范围 | 优先级 |
|------|---------|--------|
| ChatInputHome 拖拽上传 + 多文件 | 378 行变更 | P0 |
| MarkdownRenderer 流式 process 标签修复 | groupMarkdownProcesses 重写 | P0 |
| 技能订阅/付费集成 | MentionPopup + PaymentSubscriptionModal | P1 |
| ChatUploadFile 上传状态优化 | 图片/文档上传 loading 状态 | P1 |
| conversationInfo 文件刷新逻辑 | 手动刷新 vs 节流分离 | P2 |
| AppDev 流式渲染修复 | 自定义标签全量重推 | P2 |
| FileTreeView 优化 | useRef 管理刷新状态 | P3 |

---

## P0 — 必须迁移（影响核心体验）

### 1. ChatInputHome 拖拽文件上传 + 多文件支持

**nuwax commit**: `9341a145` — feat(ChatInputHome): 完善会话输入框，支持对上传多个文件、拖拽文件上传的功能

**变更内容**:
- 粘贴功能从「仅图片」扩展为「所有文件类型」（图片、PDF、文档等）
- 新增 `extractClipboardFiles` 替代旧的 `handlePaste`（仅提取 image）
- 新增拖拽上传：`dragCounterRef` + `isDragging` state + dragenter/dragleave/dragover/drop 事件
- 拖拽时显示半透明遮罩提示用户释放文件
- 上传结果统一通过 `applyServerUploadResult` 处理（提取 url/key/fileName/mimeType）

**workbench 现状**:
- ✅ 已有 `usePasteUpload` hook，但仅支持图片粘贴
- ✅ 已有 `<input type="file" multiple>` 点击上传
- ❌ 无拖拽上传（drag & drop）
- ❌ 粘贴仅支持 image/* 类型，不支持文档

**迁移工作量**: ~2h
- 扩展 `usePasteUpload` 的 `extractFiles` 逻辑：从 `item.type.indexOf('image')` 改为 `item.kind === 'file'`
- 在 `ChatInputHome` 外层 div 添加 onDragEnter/onDragLeave/onDragOver/onDrop
- 添加 `isDragging` state + 拖拽遮罩 UI + CSS

### 2. MarkdownRenderer 流式 process 标签去重 + URL 编码

**nuwax commits**: `4f34ca37` + `05df07d3`
- `4f34ca37`: 修复流式渲染中 process 标签重复及属性解析问题
- `05df07d3`: 修复流式传输中工具块连续合并的嵌套渲染异常

**变更内容**:
- `groupMarkdownProcesses` 重写：
  - 新增 executeId 去重逻辑（SSE 流式追加导致同一 executeId 出现多次）
  - 扫描所有匹配项，按 executeId 分组，只保留最后一条（属性最全）
  - 对 `name` 属性做 URL 编码（`encodeURIComponent`），防止换行/引号破坏 markdown HTML 解析
  - `<markdown-custom-process-group>` 外层包裹 `<div>` 防止解析为行内 `<p>`

**workbench 现状**:
- ✅ 已有 `groupMarkdownProcesses`，但是旧版本（无 executeId 去重、无 URL 编码）
- ❌ 缺少 SSE 流式追加时的 executeId 去重
- ❌ 缺少 name 属性 URL 编码
- ❌ group 标签缺少外层 `<div>` 包裹

**迁移工作量**: ~1.5h
- 重写 `groupMarkdownProcesses.ts` 中的 `groupMarkdownProcesses` 函数
- 加入 executeId 扫描 + dedup 逻辑
- 加入 name 属性 URL 编码
- group 标签外层加 `<div>`

---

## P1 — 应该迁移（功能完整性）

### 3. 技能订阅/付费集成

**nuwax commit**: `a9a2d09c` — feat(subscription): 添加技能订阅功能和支付弹窗支持

**变更内容**:
- `SkillInfoForAt` 类型新增字段：`paymentRequired`、`price`、`subscribed`、`overCallLimit`
- `MentionItem` 新增：`paymentRequired?`、`subscribed?`
- `MentionPopup` 新增 prop：`enableSubscription`（租户配置开关）
- `MentionEditor` 新增 prop：`enableSubscription` + `onUnsubscribedSkillSelect`
- 列表项渲染：付费未订阅技能显示价格 Tag + 点击后触发订阅弹窗回调
- `PaymentSubscriptionModal` 组件（535 行）：订阅套餐选择 + 支付流程
- `useSubscription` hook（137 行）：创建订单、查询套餐、查询我的订阅

**workbench 现状**:
- ❌ 无订阅/付费概念
- ❌ MentionPopup 无 `paymentRequired` / `subscribed` 字段
- ❌ 无 PaymentSubscriptionModal

**迁移工作量**: ~4h（需要后端 API 配合）
- `WorkbenchSkillOption` 类型加 `paymentRequired` / `subscribed` / `price`
- adapter `listSkillsForAtPaged` 解析新字段
- MentionPopup 列表项条件渲染付费标签
- 判断 `tenantConfig.enableSubscription` 开关
- PaymentSubscriptionModal 组件迁移（依赖较多：antd Modal/支付 API）

### 4. ChatUploadFile 上传状态优化

**nuwax commit**: ChatUploadFile 日常优化

**变更内容**:
- 图片/文档上传中：用 `file.status === UploadFileStatus.uploading` 判断 loading 状态
- 上传中使用服务端 URL 渲染图片（而非本地 blob URL）
- 移除注释掉的 CheckCircleOutlined 成功状态图标
- 统一 `isUploading` 判断逻辑

**workbench 现状**:
- ✅ 基本功能已有，但上传中状态判断逻辑不够精确
- 需要对齐 `UploadFileStatus` enum

**迁移工作量**: ~0.5h

---

## P2 — 可选迁移（体验优化）

### 5. conversationInfo 文件刷新逻辑分离

**变更内容**:
- 将 `handleRefreshFileList`（节流 5s）拆分为：
  - `refreshFileListImmediately`：手动点击刷新按钮，不节流
  - `handleRefreshFileList`：SSE/自动触发场景，节流 2s
- 使用 `useMemo` + `throttle` 替代 `useCallback` + `throttle`

**workbench 影响**: 低 — workbench 的 FilePreview 是独立实现，不依赖 nuwax 的 conversationInfo model

### 6. AppDev 流式渲染修复（自定义标签全量重推）

**nuwax commit**: `d632c8d0` — fix(useAppDevMarkdownRender): 修复含自定义标签的流式内容增量渲染导致 HTML 结构不完整的问题

**变更内容**:
- 检测内容含 `<appdev-` 自定义标签时，强制全量清空重新推送（非增量）
- 防止增量分片导致 HTML 结构断裂被 Rehype 降级为普通文本

**workbench 影响**: 中 — workbench 的 MarkdownRenderer 也有类似的自定义标签（`<markdown-custom-process>`），可能存在相同的增量渲染问题
- 需要在流式推送逻辑中加入自定义标签检测 + 全量重推策略

**迁移工作量**: ~1h

---

## P3 — 低优先级（按需）

### 7. FileTreeView 优化
- 使用 `useRef` 管理刷新状态替代直接引用
- 添加清除选中文件 ID 功能
- workbench 有独立的 FilePreview，影响较小

### 8. 空间资源管理重构
- SelectionList 通用组件封装
- 插件/工作流分组管理
- 与 `/app` agent workbench 无直接关系，不需要迁移

---

## 建议执行顺序

1. **P0-1: ChatInputHome 拖拽上传** → 直接提升用户体验
2. **P0-2: MarkdownRenderer process 标签修复** → 修复流式渲染 bug
3. **P1-4: ChatUploadFile 状态优化** → 快速对齐
4. **P2-6: 流式渲染全量重推** → 防止 HTML 结构断裂
5. **P1-3: 技能订阅/付费** → 需要后端 API 就绪后再迁移

## 不迁移项

- PaymentSubscriptionModal（535 行，深度依赖 antd/支付系统，建议在 NuwaClaw 层处理）
- 空间资源管理重构（SelectionList 等，不属于 `/app` 范畴）
- FileTreeView 的内部优化（workbench 有独立实现）
