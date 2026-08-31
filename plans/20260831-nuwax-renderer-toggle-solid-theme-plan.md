# nuwax 双线调试开关 + solid 主题修复（2026-08-31）

> 子模块 `feat/conversation-renderer-v2`：78ba697df（feat 调试开关）→ b3f062f7e（fix 主题）→ ea6356180（dist）。
> 本文为计划与偏离记录工件（ZCode plan mode 产物，对应父仓本次 pin bump）。

## 背景与诉求

1. **双线调试开关**：mock-chat 上有两条独立双线轴（e2e 四组合矩阵 = 两轴笛卡尔积）——
   会话轨（legacy/runtime，`?conversationRuntime=`，hook 初始化读一次 flag，切换需组件树重建）
   与渲染线（V1 经典 Markdown / V2 工作轨迹·两级折叠梳理，`?conversationRenderer=`，
   偏好链广播即时切换）。此前只能改 URL，要求补显式开关；另外在**会话详情**页也加调试切换按钮。
2. **solid 背景主题切换不生效**：升级客户端新增的「纯色」背景主题，用户点选后没有得到
   预期的灰白纯色外观。

## 实施内容

### 问题一（78ba697df）

- `conversationRendererPreference.ts` / `conversationRuntimeFlag.ts` 各补 URL 参数写入器
  （`history.replaceState` 改写自身参数保留其余 query；渲染线写入后广播即时切线；
  会话轨写入不含重建，由调用方决定）。
- mock-chat 控制区新增两个 `Segmented`（带 data-testid）：会话轨写参后整页 reload 生效；
  渲染线即时切换。选项文案与页头 Tag「runtime 轨/legacy 轨」错开避免 e2e 文本选择器碰撞。
- 提取 `src/features/conversation/LazyConversationRendererV2.tsx`（**必须在 presentation-v2
  目录外**，保证错误边界/Suspense 留在主 bundle、先于 chunk 存在）；ChatContentArea 改为
  复用（行为与 testid 不变，chunk 失败回退 V1 合同测试保持绿）。
- 会话详情（`ConversationDetails`，AgentDetails/OpenApp AppDetails 消费）接入渲染线：
  **基线恒 V1，生效线 = `sessionOverride ?? 'v1'`**（刻意不接全局偏好链——全局默认 v2
  不改变该页存量观感）；v2 走 Lazy 包装、异常/chunk 失败回退 V1 map；头部新增
  `RendererLineToggle`（眼睛图标+Popover+Segmented+恢复默认）。
- **范围边界**：会话详情的会话轨保持 legacy——runtime session 未接入该页（自有旧 model，
  接入属独立大重构）；i18n key 落 `PC.Components.ConversationDetails.rendererLine*`。

### 问题二（b3f062f7e）

根因：灰白纯色调色板生效条件挂在「女娲蓝主色+浅色」（`isNuwaClawThemeActive` 只看
primaryColor），与「纯色」背景选项脱钩；且生效期间强制 `--xagi-background-image:none`，
图片背景切换刚写入的 url 被监听器吞回。

修复（用户已确认语义「灰白外观跟随背景维度」）：

- `isNuwaClawThemeActive` 重挂为「浅色 + backgroundId=bg-solid（或无显式定制的桌面默认）」。
- 谓词拆分 `isNuwaClawDefaultThemeActive`（桌面端且未显式定制）：app.tsx antd
  effectivePrimary 与 ThemeSwitchPanel 色板高亮改用它，显式定制后主色跟随用户选择。
- 覆盖变量集剔除 `--xagi-color-primary`（仅默认态兜底写蓝），壳推送 primary 与 webview
  生效值同源——消除「纯色+自定义主色」下 antd/CSS 变量混色。
- 让位分支按值删 `'none'` 在新语义下自洽（yield 时 backgroundId≠bg-solid，applyToDOM
  已写 url，残留 none 只可能来自覆盖层），注释已更新说明。

## 测试与验收分工

- vitest（zcode 已跑，全绿）：`test:conversation` 42 文件 / 404 用例（基线 392 + 新增 12）；
  `nuwaClawTheme.test.ts` 11/11（新语义+反例）；URL 写入器合同用例 ×2 文件；会话详情
  选线 ×3（默认恒 V1 / 会话覆盖 v2 / 按钮交互与恢复默认）。
- tsc 对改动文件无新增报错（四个既存错误在 HEAD 同位置原样存在，仅行号偏移）。
- e2e 与客户端实测（含 solid 主题观感、mock-chat 双开关）按分工交 codex 复验。

## 已知边界

- mock-chat 会话轨开关走整页 reload（scenario 选择会重置）——hook「切换即组件树重建」
  的既定风险控制语义，调试页可接受；免重载方案（内层组件 key 重建）留作后续优化。
- 会话详情 runtime 轨未接入（见上）；PreviewAndDebug/ConversationAgent 等其余入口的
  渲染线接入仍未覆盖（沿 V2 重构既定边界）。
