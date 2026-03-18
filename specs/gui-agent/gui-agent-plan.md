# GUI Agent MCP Server — Plan 计划文档

> **文档类型**: Plan（计划文档）— 描述"如何实现"，定义技术方案与架构设计
>
> **基于**: `specs/gui-agent/gui-agent.md` Spec 规范文档
>
> **模块路径**: `crates/agent-gui-server/`
>
> **日期**: 2026-03-18

---

## 1. 技术架构

### 1.1 模块划分

```
crates/agent-gui-server/
├── src/
│   ├── index.ts                  # CLI 入口: 参数解析 + 启动 MCP Server
│   ├── lib.ts                    # SDK 入口: 导出 createGuiAgentMcpServer()
│   ├── config.ts                 # 统一配置: 环境变量解析、校验、Fail Fast
│   │
│   ├── mcp/                      # MCP 协议层（外部接口）
│   │   ├── server.ts             # MCP Server 实例 (stdio + HTTP 双模式)
│   │   ├── atomicTools.ts        # 13 个原子操作 tool handler
│   │   ├── taskTools.ts          # gui_execute_task / status / abort
│   │   └── resources.ts          # MCP Resources (status/permissions/audit)
│   │
│   ├── agent/                    # Agent 循环引擎（gui_execute_task 内部）
│   │   ├── taskRunner.ts         # 循环核心: pi-mono session + 截图→LLM→操作
│   │   ├── systemPrompt.ts       # GUI Agent system prompt 模板
│   │   ├── contextCompaction.ts  # 三层记忆管理 (Recent/Summary/Discard)
│   │   └── stuckDetector.ts      # 卡死检测: 连续截图相似度比对
│   │
│   ├── desktop/                  # 桌面操作层（底层能力封装）
│   │   ├── screenshot.ts         # 截图管线: capture → scale → JPEG → base64
│   │   ├── mouse.ts              # 鼠标: click/doubleClick/move/drag/scroll
│   │   ├── keyboard.ts           # 键盘: type/pressKey/hotkey
│   │   ├── clipboard.ts          # 剪贴板: CJK粘贴、备份恢复
│   │   ├── display.ts            # 显示器: 列表、scaleFactor、全局偏移
│   │   └── imageSearch.ts        # 图像查找 (nut.js template matcher)
│   │
│   ├── coordinates/              # 坐标系统（核心难点，独立目录）
│   │   ├── resolver.ts           # CoordinateResolver: 模型坐标 → 逻辑坐标 → 全局坐标
│   │   └── modelProfiles.ts      # 模型配置表: 坐标模式、目标分辨率
│   │
│   ├── safety/                   # 安全层
│   │   ├── hotkeys.ts            # 危险热键黑名单拦截
│   │   ├── rateLimiter.ts        # 令牌桶速率限制
│   │   └── auditLog.ts           # 环形缓冲审计日志
│   │
│   └── utils/
│       ├── logger.ts             # 日志: stderr + 可选文件
│       ├── platform.ts           # 平台检测、权限检查
│       └── errors.ts             # 结构化错误类型
│
├── tests/                        # Vitest 测试
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**关键设计决策**：

- **`desktop/` vs `tools/`**: Spec 用了 `tools/` 但会与 MCP 的 "tool" 概念冲突。底层桌面操作命名为 `desktop/`，与 MCP 工具层 (`mcp/`) 明确分离。MCP handler 调 desktop 层，desktop 层不知道 MCP 存在（依赖反转）
- **`coordinates/` 独立目录**: 坐标转换是核心难点（7+ 模型配置 + 三步转换 + 多屏偏移），独立提升可维护性和可测试性

### 1.2 模块依赖关系

```
index.ts → config.ts → mcp/server.ts
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        mcp/atomicTools.ts      mcp/taskTools.ts
              │                       │
              ▼                       ▼
        safety/* (前置检查)      agent/taskRunner.ts
              │                       │
              ▼                       ├── agent/systemPrompt.ts
        desktop/*                     ├── agent/contextCompaction.ts
              │                       ├── agent/stuckDetector.ts
              ▼                       └── pi-mono (LLM + tool calling)
        coordinates/resolver.ts              │
              │                              ▼
              ▼                        desktop/* (复用)
        coordinates/modelProfiles.ts
```

**数据流 — 原子操作** (`gui_click`):
```
MCP tool call → atomicTools → rateLimiter.check() → hotkeys.validate()
  → resolver.resolve(x, y, mode, meta) → display.getGlobalOffset()
  → mouse.click(globalX, globalY) → auditLog.record() → MCP response
```

**数据流 — 完整任务** (`gui_execute_task`):
```
MCP tool call → taskTools → taskRunner.run(taskText) → 循环 {
  screenshot.capture() → pi-mono complete(model, context + screenshot)
  → 解析 LLM tool call → resolver.resolve() → desktop 操作
  → delay(stepDelayMs) → stuckDetector.check()
  → contextCompaction.compact()
} → MCP response (steps + finalScreenshot + result)
```

---

## 2. 关键技术决策

### 2.1 pi-mono 的使用边界

| 场景 | 是否使用 pi-mono | 理由 |
|------|:---:|------|
| 原子操作 (gui_click 等) | 否 | 纯工具执行，无需 LLM |
| gui_execute_task 的 LLM 调用 | 是 | 用 `@mariozechner/pi-ai` 的 `getModel()` + `complete()` 做多 Provider LLM 调用 |
| gui_execute_task 的工具注册 | 是 | 用 pi-agent-core 的 TypeBox schema 注册内部 tools (screenshot/click/type/done) |
| context compaction | 是 | 用 pi-agent-core 的 `transformContext` hook |

MCP Server 和 pi-mono Agent 是**两个独立的框架**，各司其职：
- MCP Server 负责外部协议（文本 Agent 调用）
- pi-mono 负责内部 Agent 循环（LLM + tool calling）

### 2.2 nut.js 而非 robotjs

robotjs 已停止维护（2018），不支持 Apple Silicon 和 Node 22。nut.js 活跃维护，跨平台，async API，逻辑坐标空间与我们的坐标转换链路契合。

### 2.3 gui_execute_task 同步阻塞

MCP tool call 同步阻塞返回，通过 `server.sendProgressNotification()` 发送每步进度。`gui_task_status` 和 `gui_abort_task` 作为额外的查询/控制接口。

同一时间只允许一个 gui_execute_task 执行（single-flight），新任务到来时如果当前忙返回 busy 错误。

### 2.4 截图管线: nut.js + sharp

- nut.js `screen.capture(region)` 获取原始 RGBA Buffer（物理分辨率）
- sharp 做 resize（`kernel: 'lanczos3'`）+ JPEG 编码（`quality: 75`）
- sharp 已在 monorepo 中验证可用

### 2.5 SDK 嵌入模式

`lib.ts` 导出 `createGuiAgentMcpServer(config)` 工厂函数，供 Electron 客户端未来直接 import 集成。package.json 中 `"main": "./dist/lib.js"` 导出 SDK，`"bin"` 导出 CLI。

---

## 3. 各模块详细设计

### 3.1 config.ts — 统一配置

- 解析所有 `GUI_AGENT_*` 环境变量，返回类型安全的 `GuiAgentConfig` 对象
- 必填字段（如 `API_KEY`）缺失时直接 throw，进程退出（Fail Fast）
- 数值参数做范围校验（jpegQuality 1-100，maxSteps 1-200）
- `coordinateMode` 为空时表示自动匹配（由 modelProfiles 决定）

### 3.2 coordinates/modelProfiles.ts — 模型配置表

- 内置正则匹配数组：`claude-*` → image-absolute + 1280×800，`gemini*` → normalized-999 + 1440×900，等
- `getModelProfile(modelName, logicalWidth?, logicalHeight?)` → `ModelProfile`
- 未匹配 fallback: image-absolute + 逻辑分辨率
- 环境变量 `GUI_AGENT_COORDINATE_MODE` 可覆盖
- 扩展新模型只需在数组中加一条

### 3.3 coordinates/resolver.ts — CoordinateResolver

**核心三步转换**（纯函数，零 I/O，高可测试性）：

1. **归一化** (0~1): 根据 coordinateMode 处理
   - image-absolute: `normX = modelX / imageWidth`
   - normalized-1000: `normX = modelX / 1000`
   - normalized-999: `normX = modelX / 999`
   - normalized-0-1: `normX = modelX`（直接用）
2. **逻辑坐标**: `localX = normX × logicalWidth`
3. **全局偏移**: `globalX = localX + display.origin.x`

边界校验：结果 clamp 到目标显示器范围内，超出记 warning。

### 3.4 desktop/screenshot.ts — 截图管线

1. 获取目标显示器信息（bounds、scaleFactor）
2. nut.js `screen.capture(region)` 截取目标显示器区域（物理分辨率）
3. 确定目标分辨率：有 modelProfile 用 `targetWidth×targetHeight`，无则用逻辑分辨率
4. sharp resize + JPEG encode
5. 检查字节数是否超限，超限则降 quality 重试
6. 返回 `ScreenshotResult`（base64 + 完整元数据）

### 3.5 desktop/keyboard.ts + clipboard.ts — 文本输入

**typeText 智能路由**:
- 包含非 ASCII (`/[^\x00-\x7F]/`) 或长度 > 50 → clipboard.pasteText()
- 否则 → nut.js keyboard.type()

**clipboard.pasteText 流程**:
1. 读取当前剪贴板（通过 `clipboardy` 库，跨平台）
2. 写入目标文本
3. 模拟 Cmd+V (macOS) / Ctrl+V (Win/Linux)
4. 等待 100ms
5. 恢复原剪贴板（try-catch 包裹，失败不阻断主流程）

### 3.6 agent/taskRunner.ts — Agent 循环引擎

1. 创建 pi-mono model: `getModel(config.provider, config.model)`
2. 注册内部 tools（TypeBox schema）：computer_screenshot, computer_click, computer_type, computer_scroll, computer_hotkey, computer_wait, computer_done
3. 构造初始 context: system prompt + 第一张截图 + 任务描述
4. 循环 `complete(model, context)`:
   - 解析 LLM tool call → CoordinateResolver 转坐标 → 执行桌面操作
   - 等待 stepDelayMs → 截图验证 → stuckDetector → contextCompaction
   - LLM 调 `computer_done` 则退出循环
   - 达到 maxSteps 强制退出
5. 每步通过 `onProgress` 回调推送进度通知

### 3.7 agent/contextCompaction.ts — 上下文压缩

利用 pi-mono 的 `transformContext` hook，每次 LLM 调用前执行：

- 估算 token 数：文字 `text.length / 4`，每张截图按 ~1600 token
- 超过 80% 上限时触发压缩：
  1. 最旧步骤：删除截图 base64，保留文字描述
  2. 仍超限：合并最早 N 步文字为一段摘要
- **始终保留最近 3 步的完整截图**（LLM 需要近期视觉上下文）

### 3.8 agent/stuckDetector.ts — 卡死检测

- 将截图缩放到 32×32 → 计算与前 N 步（默认 3）的像素均值差异
- 连续 N 步差异 < 阈值（5%）→ 判定卡死，自动终止
- 简化方案，不需要 SSIM 或感知哈希

### 3.9 safety — 安全层

| 模块 | 实现 |
|------|------|
| **rateLimiter** | 滑动窗口计数器，最近 1s 内操作数 ≥ maxOps 则拒绝 |
| **hotkeys** | 组合键黑名单匹配，按平台区分（macOS: Cmd+Q, Win: Alt+F4 等） |
| **auditLog** | 固定大小数组 (1000)，环形写入，通过 MCP Resource 暴露 |

### 3.10 mcp/server.ts — MCP Server

- stdio 模式: `new Server()` + `StdioServerTransport`
- HTTP 模式: `new Server()` + `StreamableHTTPServerTransport`
- 注册 `ListToolsRequestSchema` 和 `CallToolRequestSchema` handler
- CallTool handler 内部路由到 atomicTools / taskTools
- 参考 `nuwax-mcp-stdio-proxy` 的 Server 创建模式

---

## 4. Electron 客户端改造

### 4.1 改造范围

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `src/main/services/computerServer.ts` | 新增 4 个 `/computer/gui-agent/*` 路由 |
| 修改 | `src/shared/types/computerTypes.ts` | 新增 `GuiVisionModelConfig` 类型 |
| 新增 | `src/renderer/components/GUIAgentSettings.tsx` | 显示器选择 + 视觉模型配置 UI |
| 修改 | `src/renderer/components/SettingsPage.tsx` | 集成 GUIAgentSettings 标签页 |

### 4.2 computerServer.ts 新增路由

在 `handleRequest` 中新增 4 个路由（复用现有的 JSON envelope 响应格式）：

| 路径 | 方法 | 逻辑 |
|------|------|------|
| `/computer/gui-agent/vision-model` | POST | 验证 body → 存 SQLite |
| `/computer/gui-agent/vision-model` | GET | 读 SQLite → 附加推断参数 |
| `/computer/gui-agent/displays` | GET | `screen.getAllDisplays()` |
| `/computer/gui-agent/display` | POST | 校验 displayIndex → 存 SQLite |

### 4.3 配置传递

启动 GUI Agent MCP Server 子进程时，从 SQLite 读取配置，注入为环境变量：
`GUI_AGENT_PROVIDER`, `GUI_AGENT_MODEL`, `GUI_AGENT_API_KEY`, `GUI_AGENT_BASE_URL`, `GUI_AGENT_DISPLAY_INDEX`, `GUI_AGENT_COORDINATE_MODE`

---

## 5. 实现阶段

### Phase 1: 项目脚手架 + 原子操作

**目标**: MCP Server 启动，13 个原子操作可调用。

1. 创建 `crates/agent-gui-server/`，配置 package.json / tsconfig / vitest（参考 nuwax-mcp-stdio-proxy 约定）
2. config.ts — 环境变量解析
3. utils/ — logger, platform, errors
4. coordinates/ — modelProfiles + resolver
5. desktop/ — display, screenshot, mouse, keyboard, clipboard, imageSearch
6. safety/ — rateLimiter, hotkeys, auditLog
7. mcp/ — atomicTools, resources, server (stdio)
8. index.ts — CLI 入口

**验收**: `tools/list` 返回 13 个工具；`gui_screenshot` 返回正确截图和元数据。

### Phase 2: 坐标转换验证 + 多屏

**目标**: 坐标转换准确，多屏正确。

1. CoordinateResolver 单元测试：覆盖所有 7 种模型 + Retina/HiDPI + 多屏偏移
2. 截图管线单元测试：不同分辨率缩放后 metadata 正确
3. 端到端：MCP 调 `gui_screenshot` + `gui_click`，验证点击位置

### Phase 3: Agent 循环 (gui_execute_task)

**目标**: gui_execute_task 能执行自然语言 GUI 任务。

1. 安装 pi-mono 依赖
2. agent/systemPrompt.ts — 专用 system prompt
3. agent/taskRunner.ts — 循环核心
4. agent/contextCompaction.ts — token 压缩
5. agent/stuckDetector.ts — 卡死检测
6. mcp/taskTools.ts — 注册 gui_execute_task / status / abort
7. 进度通知集成

**验收**: `gui_execute_task("打开 Finder")` 自动完成，返回步骤日志。

### Phase 4: HTTP 传输 + SDK 导出

**目标**: 支持 HTTP 模式，提供 SDK 入口。

1. CLI 增加 `--transport http --port <port>`
2. StreamableHTTPServerTransport 集成
3. lib.ts — SDK 工厂函数导出

### Phase 5: Electron 客户端改造

**目标**: 显示器选择 + 视觉模型配置接口。

按第 4 节执行。

### Phase 6: 集成测试 + 文档

1. 与 claude-code / nuwaxcode 的 MCP 集成验证
2. 跨平台基本验证
3. README.md

---

## 6. 测试策略

### 重点单元测试

| 模块 | 覆盖重点 |
|------|---------|
| coordinates/resolver | 所有坐标家族转换、Retina/HiDPI、多屏偏移、边界 clamp |
| coordinates/modelProfiles | 模型名匹配、fallback、环境变量覆盖 |
| desktop/screenshot | 缩放计算、JPEG quality 降级、metadata 完整性 |
| desktop/clipboard | CJK 检测、长文本路由、剪贴板备份恢复 |
| safety/* | 限流、黑名单匹配、环形缓冲 |
| agent/contextCompaction | token 估算、压缩触发、截图保留策略 |
| agent/stuckDetector | 相同/不同截图判定 |
| config | 必填校验、默认值 |

### Mock 策略

- **nut.js**: mock 避免实际操作桌面
- **sharp**: mock resize/jpeg/toBuffer 链，验证调用参数
- **pi-mono**: mock `getModel` + `complete`，返回预设 tool call
- 框架: Vitest，配置参考 nuwax-mcp-stdio-proxy

---

## 7. 风险与应对

| 风险 | 应对 |
|------|------|
| nut.js prebuilt binary 某平台不可用 | CI 验证三平台；备选: platform-specific CLI (screencapture, cliclick) |
| pi-mono 某 Provider 的 tool calling 不兼容 | Anthropic + OpenAI 是核心场景，其他验证后再加入 modelProfiles |
| macOS 权限弹窗阻塞首次使用 | `gui://permissions` Resource 报告状态；README 提供授权步骤 |
| Agent 循环 token 消耗过快 | contextCompaction 必须实现；maxSteps=50 限制；JPEG quality=75 |
| Linux Wayland 不支持 | v1 仅支持 X11，Wayland 为 v2 |
| sharp 与 Electron 版本冲突 (SDK 嵌入模式) | MCP Server 独立进程无此问题；嵌入模式需 electron-rebuild |

---

## 8. 依赖清单

| 依赖 | 用途 |
|------|------|
| `@modelcontextprotocol/sdk` ^1.27.1 | MCP Server |
| `@nut-tree/nut-js` ^4.2.0 | 桌面自动化 |
| `@mariozechner/pi-ai` | 多 Provider LLM 调用 |
| `@mariozechner/pi-agent-core` | Agent 循环 + tool calling |
| `sharp` ^0.33.0 | 截图 resize + JPEG 编码 |
| `clipboardy` ^4.0.0 | 跨平台剪贴板读写 |

---

## 参考文件

| 文件 | 参考内容 |
|------|---------|
| `specs/gui-agent/gui-agent.md` | Spec 规范文档（权威需求来源） |
| `crates/nuwax-mcp-stdio-proxy/package.json` | 工程约定: ES modules、依赖版本、build/test scripts |
| `crates/nuwax-mcp-stdio-proxy/src/index.ts` | CLI 入口模式 |
| `crates/nuwax-mcp-stdio-proxy/src/shared/proxy-server.ts` | MCP Server 创建模式 |
| `crates/agent-electron-client/src/main/services/computerServer.ts` | Electron 改造目标（新增路由） |
| `crates/agent-electron-client/src/shared/types/computerTypes.ts` | 类型扩展（新增 GuiVisionModelConfig） |
