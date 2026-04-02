# GUI Agent MCP Server — Task 任务文档

> **文档类型**: Task（任务文档）— 描述"具体执行"，拆解后的最小行动单元
>
> **基于**: `specs/gui-agent/gui-agent-plan.md` Plan 计划文档
>
> **模块路径**: `crates/agent-gui-server/`

---

## Context

构建 GUI Agent MCP Server — 一个桌面自动化服务，文本 Agent（claude-code、nuwaxcode）通过 MCP 协议调用它，执行截图识别 + 键鼠模拟。项目基于 pi-mono Agent 循环引擎，采用 Streamable HTTP 主模式 + stdio 备选，Mutex 互斥锁保证同时只有一个 GUI 任务执行。

---

## 约定

- **ID 格式**: `T{phase}.{seq}`（如 T1.1）
- **`[P]`** = 可与同 Wave 内其他任务并行
- **depends** = 必须等待前置任务完成
- 所有文件路径相对于 `crates/agent-gui-server/`
- 参考项目约定: `crates/nuwax-mcp-stdio-proxy/`（ESM、Node≥22、tsc+esbuild、Vitest）

---

## Phase 1: 项目脚手架 + 原子操作

> **目标**: MCP Server 启动（Streamable HTTP），13 个原子操作可调用

### Wave 1 — 项目初始化

#### T1.1 创建项目脚手架

**创建文件**:
- `package.json` — `"type": "module"`, Node≥22, `"bin": { "agent-gui-server": "dist/index.js" }`, `"main": "./dist/lib.js"`
- `tsconfig.json` — target ES2022, module/moduleResolution Node16, strict, declaration
- `vitest.config.ts` — globals, node env, 15s timeout, v8 coverage
- `scripts/build.mjs` — esbuild 单文件 bundle + shebang

**依赖**:
```
dependencies:
  @modelcontextprotocol/sdk ^1.27.1
  @nut-tree/nut-js ^4.2.0
  sharp ^0.33.0
  clipboardy ^4.0.0

devDependencies:
  typescript ^5.7.0
  vitest ^2.1.8
  @vitest/coverage-v8 ^2.1.9
  esbuild ^0.27.3
  @types/node ^22.0.0
```

**参考**: `crates/nuwax-mcp-stdio-proxy/package.json`, `tsconfig.json`, `vitest.config.ts`, `scripts/build.mjs`

**验收**: `pnpm install` 成功解析新 workspace 成员

---

### Wave 2 — 基础设施层（全部 [P] 并行）

#### T1.2 `src/utils/errors.ts` [P]

5 个结构化错误类，继承 Error，readonly context 字段：
- `ConfigError(message)`
- `DesktopError(operation, cause)`
- `CoordinateError(coordinateMode, rawX, rawY)`
- `SafetyError(keys, reason)`
- `TaskExecutionError(taskText, step, cause)`

**参考**: `crates/nuwax-mcp-stdio-proxy/src/errors.ts`

#### T1.3 `src/utils/logger.ts` [P]

- stderr 输出，格式: `[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL]  [gui-agent] message`
- `GUI_AGENT_LOG_FILE` 环境变量启用文件日志，日轮转，保留 7 天
- 导出: `logInfo`, `logWarn`, `logError`, `logDebug`

**参考**: `crates/nuwax-mcp-stdio-proxy/src/logger.ts`

#### T1.4 `src/utils/platform.ts` [P]

- `getPlatform(): 'macos' | 'windows' | 'linux'`
- `checkScreenRecordingPermission(): Promise<boolean>`
- `checkAccessibilityPermission(): Promise<boolean>`
- `getPlatformPasteKeys(): Key[]`（macOS: Cmd+V, 其他: Ctrl+V）

---

### Wave 3 — 配置 + 坐标 + 桌面操作（大部分 [P] 并行）

#### T1.5 `src/config.ts`

**depends**: T1.2, T1.3

- `GuiAgentConfig` 接口，解析所有 `GUI_AGENT_*` 环境变量
- Fail Fast: `API_KEY` 缺失直接 throw `ConfigError`
- 数值范围校验: jpegQuality(1-100), maxSteps(1-200), port(1-65535), stepDelayMs(100-30000)
- 默认值: provider=`anthropic`, model=`claude-sonnet-4-20250514`, port=60008, maxSteps=50, stepDelayMs=1500, stuckThreshold=3, jpegQuality=75, displayIndex=0, transport=`http`

#### T1.6 `src/coordinates/modelProfiles.ts` [P]

**depends**: T1.2

- 7 条正则匹配规则 → `ModelProfile { coordinateMode, coordinateOrder }`
- Gemini → `{ normalized-999, yx }`，其余 → `xy`
- fallback: `image-absolute` + `xy`
- `getModelProfile(modelName, overrideMode?): ModelProfile`

#### T1.7 `src/coordinates/resolver.ts`

**depends**: T1.6

纯函数，零 I/O，四步转换：
1. 坐标顺序修正（yx swap for Gemini）
2. 归一化到 0~1
3. 逻辑坐标 = norm × logicalWidth/Height
4. 全局偏移 = local + display.origin

边界 clamp + warning 日志

#### T1.8 `src/desktop/display.ts` [P]

**depends**: T1.2, T1.3

- `DisplayDescriptor { index, label, width, height, scaleFactor, isPrimary, origin }`
- `listDisplays()`, `getDisplay(index)`, `getPrimaryDisplay()`

#### T1.9 `src/desktop/screenshot.ts`

**depends**: T1.8

截图管线:
1. nut.js `screen.capture(region)` 物理分辨率
2. sharp resize 到逻辑分辨率（吸收 scaleFactor）
3. 最长边 > 1920 则等比缩放到 1920
4. JPEG encode quality=75
5. 超限降 quality 重试
6. 返回 `ScreenshotResult`（base64 + imageWidth/Height + logicalWidth/Height + physicalWidth/Height + scaleFactor）

#### T1.10 `src/desktop/mouse.ts` [P]

**depends**: T1.2

click, doubleClick, moveTo, drag, scroll, getPosition — 包装 nut.js

#### T1.11 `src/desktop/keyboard.ts` [P]

**depends**: T1.2, T1.4

- `typeText(text)` — 非 ASCII 或 >50 字符 → clipboard.pasteText，否则 nut.js type
- `pressKey(key)`, `hotkey(keys[])`

#### T1.12 `src/desktop/clipboard.ts` [P]

**depends**: T1.2, T1.4

- `pasteText(text)` — 备份剪贴板 → 写入 → Cmd/Ctrl+V → 100ms → 恢复（try-catch）
- `readClipboard()`, `writeClipboard(text)` — 使用 clipboardy

#### T1.13 `src/desktop/imageSearch.ts` [P]

**depends**: T1.2

- `findImage(templateBase64, confidence?)` → `{ found, region?, confidence? }`
- `waitForImage(templateBase64, timeout?, confidence?)` → `{ found, region?, elapsed }`

---

### Wave 4 — 安全层（[P] 并行）

#### T1.14 `src/safety/hotkeys.ts` [P]

**depends**: T1.2, T1.4

- `validateHotkey(keys[]): { blocked, reason? }`
- 平台黑名单: macOS(Cmd+Q, Cmd+W, Cmd+Opt+Esc), Windows(Alt+F4, Ctrl+Alt+Del), Linux(Ctrl+Alt+Del)

#### T1.15 `src/safety/auditLog.ts` [P]

**depends**: T1.2

- `AuditLog` class — 环形缓冲 1000 条
- `record(entry)`, `getEntries(count?)`, `clear()`

---

### Wave 5 — MCP 协议层

#### T1.16 `src/mcp/atomicTools.ts`

**depends**: T1.7, T1.9, T1.10, T1.11, T1.12, T1.13, T1.14, T1.15

注册 13 个 MCP tool handler:
`gui_screenshot`, `gui_click`, `gui_double_click`, `gui_move_mouse`, `gui_drag`, `gui_scroll`, `gui_type`, `gui_press_key`, `gui_hotkey`, `gui_cursor_position`, `gui_list_displays`, `gui_find_image`, `gui_wait_for_image`

每个 handler: 输入校验 → safety 检查 → 坐标解析 → desktop 操作 → audit 记录 → 返回结果

#### T1.17 `src/mcp/resources.ts` [P with T1.16]

**depends**: T1.4, T1.15

3 个 MCP Resource: `gui://status`, `gui://permissions`, `gui://audit-log`

#### T1.18 `src/mcp/server.ts`

**depends**: T1.16, T1.17

双模式 MCP Server:
- **HTTP 主模式**: `http.createServer()` 监听 `127.0.0.1:<port>`，`/mcp` 路径，per-session `StreamableHTTPServerTransport` + `Server`，session 管理 + 定期清理
- **stdio 备选**: 单 `Server` + `StdioServerTransport`

**参考**: `crates/nuwax-mcp-stdio-proxy/src/bridge.ts`（PersistentMcpBridge 模式）

#### T1.19 `src/index.ts`

**depends**: T1.5, T1.18

CLI 入口: `--port <number>`, `--transport <http|stdio>`, SIGINT/SIGTERM graceful shutdown

---

### Wave 6 — Phase 1 验收

#### T1.20 冒烟测试

**depends**: T1.19

- `tools/list` 返回 13 个工具
- `gui_screenshot` 返回 base64 + 正确 metadata
- `gui_list_displays` 返回显示器数组
- HTTP 模式支持多客户端并发连接

---

## Phase 2: 坐标转换验证 + 多屏

> **目标**: 坐标转换准确，多屏正确

#### T2.1 `tests/coordinates/resolver.test.ts` [P]

覆盖: 4 种坐标模式 × Gemini yx swap × Retina/HiDPI × 多屏偏移 × 边界 clamp × Spec 3.4.6 示例

#### T2.2 `tests/coordinates/modelProfiles.test.ts` [P]

覆盖: 7 条模型匹配 + fallback + coordinateOrder + override

#### T2.3 `tests/desktop/screenshot.test.ts` [P]

mock nut.js + sharp，覆盖: Retina 2880×1800 → 1440×900、4K → 1920×1080、1080p 不缩放、quality 降级重试

#### T2.4 多屏端到端测试

**depends**: T2.1

mock 多显示器，验证主屏/副屏坐标偏移正确

---

## Phase 3: Agent 循环 (gui_execute_task)

> **目标**: gui_execute_task 能执行自然语言 GUI 任务

#### T3.1 添加 pi-mono 依赖

新增 dependencies: `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@sinclair/typebox`

#### T3.2 `src/agent/systemPrompt.ts` [P]

**depends**: T3.1

`buildSystemPrompt(taskText, memoryText): string` — 角色描述、7 个内部工具说明、坐标指引、popup 处理、computer_done 使用指导、memory 注入点

#### T3.3 `src/agent/stuckDetector.ts` [P]

`StuckDetector` class — 截图缩放 32×32 → 像素均值差异 < 5% 连续 N 次 → 判定卡死

#### T3.4 `src/agent/memoryManager.ts`

**depends**: T3.1

三层记忆管理（参考 TuriX-CUA）:

```
summaryMemory (budget 2000 chars) ← LLM 摘要压缩
recentMemory  (budget 500 chars)  ← finalizeStep 写入
pendingMemory (no budget)         ← addPendingStep 写入
```

核心 API:
- `addPendingStep(stepId, goal)`
- `async finalizeStep(stepId, evaluation)` — pending→recent，超 budget 触发 `complete(memoryModel, context)` 摘要
- `compose(): string` — 组合三层文本
- `pruneScreenshots(messages): AgentMessage[]` — 保留最近 3 步截图，老截图替换为文字占位

记忆摘要通过独立 `complete()` 调用（不走 Agent 循环）

#### T3.5 `src/agent/taskRunner.ts`

**depends**: T3.2, T3.3, T3.4, desktop/*, safety/*

**核心**: 配置 pi-mono `Agent` 实例，不手写循环

```typescript
const agent = new Agent({
  initialState: { systemPrompt, model, thinkingLevel: 'off', tools: guiTools, messages: [] },
  toolExecution: 'sequential',
  transformContext: (msgs) => memoryManager.pruneScreenshots(msgs),
  convertToLlm: (msgs) => msgs.filter(m => ['user','assistant','toolResult'].includes(m.role)),
  beforeToolCall: ({ toolCall, args }) => hotkeys 拦截,
  afterToolCall: ({ toolCall, args, result, isError }) => auditLog 记录,
});
```

7 个 `AgentTool[]`: computer_screenshot, computer_click, computer_type, computer_scroll, computer_hotkey, computer_wait, computer_done

事件订阅: `turn_end` → stepCount++, finalizeStep, stuckDetector, 更新 systemPrompt(compose()), maxSteps 检查

返回 `TaskResult { success, result?, finalScreenshot?, steps[], error? }`

#### T3.6 `src/mcp/taskTools.ts`

**depends**: T3.5

- `gui_execute_task` MCP tool handler
- Mutex 互斥锁（`let currentTask: Promise | null`）
- handler: acquire mutex → taskRunner.run(taskText, extra.signal, progressCb) → release in finally
- 进度: `extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, total } })`
- 取消: `extra.signal` → `agent.abort()`

#### T3.7 更新 `src/mcp/server.ts`

**depends**: T3.6

在 session Server 注册中添加 `registerTaskTools()`

**验收**: `tools/list` 返回 14 个工具，`gui_execute_task("打开 Finder")` 自动完成并返回步骤日志

#### T3.8 Agent 单元测试 [P with T3.7]

- `tests/agent/taskRunner.test.ts` — mock Agent/getModel/desktop，测试正常完成、abort、maxSteps
- `tests/agent/memoryManager.test.ts` — budget 触发、摘要调用、compose 输出、pruneScreenshots
- `tests/agent/stuckDetector.test.ts` — 相同/不同截图判定

---

## Phase 4: SDK 导出

#### T4.1 `src/lib.ts`

**depends**: T3.7

- `createGuiAgentMcpServer(config: Partial<GuiAgentConfig>): { start(), stop() }`
- Re-export: `GuiAgentConfig`, `ScreenshotResult`, `DisplayDescriptor`, `TaskResult`

---

## Phase 5: Electron 客户端集成

#### T5.1 类型定义

修改 `crates/agent-electron-client/src/shared/types/computerTypes.ts` — 新增 `GuiVisionModelConfig`

#### T5.2 computerServer 路由

**depends**: T5.1

修改 `crates/agent-electron-client/src/main/services/computerServer.ts` — 4 个新路由:
- `POST/GET /computer/gui-agent/vision-model`
- `GET /computer/gui-agent/displays`
- `POST /computer/gui-agent/display`

#### T5.3 GUIAgentSettings 组件 [P with T5.2]

新建 `crates/agent-electron-client/src/renderer/components/GUIAgentSettings.tsx` — 显示器选择 + 视觉模型配置

#### T5.4 集成 SettingsPage

**depends**: T5.3

修改 `crates/agent-electron-client/src/renderer/components/SettingsPage.tsx` — 添加 GUIAgentSettings 标签页

#### T5.5 workspace 集成

修改 `crates/agent-electron-client/package.json` — `"agent-gui-server": "workspace:*"` + extraResources

---

## Phase 6: 集成测试 + 文档

#### T6.1 MCP 集成测试

claude-code 通过 MCP URL 连接，list tools，调用 gui_screenshot

#### T6.2 跨平台验证

macOS + Windows + Linux(X11) 基本功能验证

#### T6.3 README.md

安装、MCP 配置示例（HTTP + stdio）、环境变量说明、开发指南

---

## 执行顺序总览

```
Phase 1 (脚手架 + 原子操作):
  Wave 1: T1.1
  Wave 2: T1.2 | T1.3 | T1.4
  Wave 3: T1.5, T1.6 | T1.8 | T1.10 | T1.11 | T1.12 | T1.13
  Wave 4: T1.7, T1.9, T1.14 | T1.15
  Wave 5: T1.16 | T1.17
  Wave 6: T1.18
  Wave 7: T1.19
  Wave 8: T1.20

Phase 2 (坐标验证):
  T2.1 | T2.2 | T2.3 → T2.4

Phase 3 (Agent 循环):
  T3.1 → T3.2 | T3.3 | T3.4 → T3.5 → T3.6 → T3.7
                                        T3.8 (parallel)

Phase 4: T4.1
Phase 5: T5.1 → T5.2 | T5.3 → T5.4, T5.5
Phase 6: T6.1 → T6.2 → T6.3
```

---

## 验证方式

1. **Phase 1 验收**: 启动 server → `curl POST /mcp` 调用 `tools/list` 返回 13 工具 → `gui_screenshot` 返回 base64
2. **Phase 2 验收**: `pnpm test` 全部通过，坐标覆盖率 >90%
3. **Phase 3 验收**: `gui_execute_task("打开 Finder")` → 自动截图分析+点击 → 返回 steps + finalScreenshot
4. **Phase 4 验收**: `import { createGuiAgentMcpServer } from 'agent-gui-server'` 可用
5. **Phase 5 验收**: Electron Settings UI 可配置视觉模型和显示器
6. **Phase 6 验收**: claude-code MCP 配置后能调用 gui_execute_task

---

## 关键参考文件

| 文件 | 用途 |
|------|------|
| `specs/gui-agent/gui-agent.md` | Spec 规范文档（权威需求源） |
| `specs/gui-agent/gui-agent-plan.md` | Plan 计划文档（技术方案源） |
| `crates/nuwax-mcp-stdio-proxy/package.json` | 工程约定模板 |
| `crates/nuwax-mcp-stdio-proxy/scripts/build.mjs` | esbuild 构建脚本模板 |
| `crates/nuwax-mcp-stdio-proxy/src/bridge.ts` | Streamable HTTP + session 管理模式 |
| `crates/nuwax-mcp-stdio-proxy/src/logger.ts` | 日志模块模板 |
| `crates/nuwax-mcp-stdio-proxy/src/errors.ts` | 错误类模板 |
